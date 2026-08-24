/**
 * Configuration: the single YAML file that defines the fleet.
 *
 * Two things live here and nowhere else:
 *  - the Zod schema every config must satisfy (SPEC.md feature 7), and
 *  - logical-model resolution (SPEC.md feature 2): a logical name such as
 *    `fast` maps to an ordered priority list of (backend, model) pairs.
 */
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/** Thrown for any unusable config; `issues` is one human-readable line per problem. */
export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`invalid config: ${issues.join('; ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

const absoluteHttpUrl = z.string().min(1).superRefine((value, ctx) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be an absolute URL' });
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must use http or https' });
  }
});

const backendSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'must be alphanumeric with . _ -'),
  /** Base of the upstream's OpenAI-compatible API, e.g. `http://localhost:11434/v1`. */
  baseUrl: absoluteHttpUrl,
});

const targetSchema = z.object({
  backend: z.string().min(1),
  model: z.string().min(1),
});

/** The config file's schema. Everything but `backends` and `models` has a default. */
export const configSchema = z
  .object({
    listen: z
      .object({
        host: z.string().min(1).default('127.0.0.1'),
        port: z.number().int().min(0).max(65535).default(8080),
      })
      .default({}),
    auth: z
      .object({
        /** Static bearer token. `null` disables auth (development only). */
        token: z.string().min(1).nullable().default(null),
      })
      .default({}),
    ledger: z
      .object({
        path: z.string().min(1).default('./ledger.jsonl'),
        /** When true the ledger records routing metadata only, never bodies. */
        redact: z.boolean().default(false),
      })
      .default({}),
    health: z
      .object({
        intervalMs: z.number().int().positive().default(10_000),
        timeoutMs: z.number().int().positive().default(2_000),
        cooldownMs: z.number().int().positive().default(30_000),
        /**
         * When true a healthy models-list probe is followed by a 1-token
         * generation probe — proof the backend can actually answer, not just
         * that it is listening. Off by default: it costs a token per tick.
         */
        generationProbe: z.boolean().default(false),
      })
      .default({}),
    backends: z.array(backendSchema).min(1, 'at least one backend is required'),
    /** logical name -> priority-ordered targets. */
    models: z.record(z.string().min(1), z.array(targetSchema).min(1)),
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    config.backends.forEach((backend, index) => {
      if (seen.has(backend.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['backends', index, 'name'],
          message: `duplicate backend name "${backend.name}"`,
        });
      }
      seen.add(backend.name);
    });

    const logicalNames = Object.keys(config.models);
    if (logicalNames.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['models'],
        message: 'at least one logical model is required',
      });
    }

    for (const logical of logicalNames) {
      const targets = config.models[logical] ?? [];
      targets.forEach((target, index) => {
        if (!seen.has(target.backend)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['models', logical, index, 'backend'],
            message: `unknown backend "${target.backend}"`,
          });
        }
      });
    }
  });

export type Config = z.infer<typeof configSchema>;
export type Backend = Config['backends'][number];
export type Target = { backend: string; model: string };

/** A logical target with its backend already looked up. */
export type ResolvedTarget = { backend: Backend; model: string };

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

/** Validate an already-parsed object. Throws {@link ConfigError} on any problem. */
export function parseConfig(raw: unknown): Config {
  const result = configSchema.safeParse(raw);
  if (!result.success) throw new ConfigError(formatIssues(result.error));
  return result.data;
}

/** Read + parse a YAML config file. Throws {@link ConfigError} on any problem. */
export function loadConfig(path: string): Config {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new ConfigError([`cannot read ${path}: ${(error as Error).message}`]);
  }

  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (error) {
    throw new ConfigError([`cannot parse ${path} as YAML: ${(error as Error).message}`]);
  }

  if (raw === null || typeof raw !== 'object') {
    throw new ConfigError([`${path} is empty or not a YAML mapping`]);
  }

  return parseConfig(raw);
}

/** The backend with this name, or undefined. */
export function getBackend(config: Config, name: string): Backend | undefined {
  return config.backends.find((backend) => backend.name === name);
}

/** Every logical model name, sorted — the source of truth for `GET /v1/models`. */
export function listLogicalModels(config: Config): string[] {
  return Object.keys(config.models).sort();
}

/**
 * Resolve a logical model to its priority-ordered targets. Unknown logical
 * names resolve to an empty array; callers turn that into a 404.
 */
export function resolveLogical(config: Config, logical: string): ResolvedTarget[] {
  const targets = config.models[logical];
  if (!targets) return [];

  const resolved: ResolvedTarget[] = [];
  for (const target of targets) {
    const backend = getBackend(config, target.backend);
    if (backend) resolved.push({ backend, model: target.model });
  }
  return resolved;
}
