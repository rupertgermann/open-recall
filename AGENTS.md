# AGENTS.md

Guidance for coding agents working in this repository.
Keep edits minimal and aligned with existing patterns.

## Quick context
- Framework: Next.js App Router (Next 16).
- Language: TypeScript (strict mode).
- UI: TailwindCSS + Shadcn UI components.
- Data: Drizzle ORM with PostgreSQL + pgvector + Apache AGE.
- AI: Vercel AI SDK (local or OpenAI providers).

## Commands
### Development
- `npm run dev` - start Next.js dev server.
- `npm run build` - production build.
- `npm run start` - run built app.
- `npm run lint` - ESLint via Next.js.

### Single-file checks
- `npx next lint --file src/app/chat/page.tsx`.
- `npm run lint -- --file src/app/chat/page.tsx`.
- No unit test runner is configured; use lint/build and manual UI checks.
### Testing
- Automated tests are not configured.
- Use `npm run lint` and `npm run build` as checks.
- Validate UI flows manually (see `README.md`/`CLAUDE.md`).
### Database
- `npm run db:generate` - generate migrations.
- `npm run db:push` - push schema in dev.
- `npm run db:migrate` - run migrations in prod.
- `npm run db:studio` - open Drizzle Studio.
### Docker
- `docker compose up db -d` - start Postgres with extensions.
- `docker compose up --build` - full stack build/run.

## Project structure
- `src/app/` - Next.js routes and pages (App Router).
- `src/app/api/` - API route handlers.
- `src/actions/` - Server actions (`"use server"`).
- `src/components/` - App-specific components.
- `src/components/ui/` - Shadcn UI primitives (avoid manual edits).
- `src/lib/` - core libraries (AI, embeddings, content, utils).
- `src/db/` - Drizzle schema and db client.
- `src/hooks/` - React hooks.

## Code style
### Formatting
- Follow the local file style when editing.
- Prefer 2-space indentation.
- Use double quotes for strings.
- Use semicolons where the file already uses them.
- Keep line lengths reasonable; rely on existing wrapping.
- No Prettier config is present; do not introduce one.

### Imports
- Order imports: external packages, then `@/` aliases, then relatives.
- Use `type` modifiers for type-only imports.
- Prefer named exports; avoid default exports unless required by Next.js pages.
- Use the `@/` alias for internal modules (`@/*` maps to `src/*`).

### TypeScript
- `strict` mode is enabled; avoid `any`.
- Use explicit return types on exported functions when non-trivial.
- Prefer `type` aliases for object shapes (project convention).
- Use `as const` for literal arrays and config enums.
- Keep React prop types inline when simple.

### React/Next.js
- Add `"use client"` only to client components.
- Keep server actions in `src/actions` with `"use server"`.
- API routes live under `src/app/api/**/route.ts`.
- Prefer async server actions over client-side fetch for DB writes.
- Revalidate caches with `revalidatePath` after mutations.
- Use `runtime`/`dynamic` exports in API routes when needed.

### Naming
- Components: `PascalCase`.
- Hooks: `useThing` prefix.
- Variables/functions: `camelCase`.
- Constants: `UPPER_SNAKE_CASE` for globals.
- File names: `kebab-case` for components; `route.ts`/`page.tsx` for Next.js.

### Styling
- Use Tailwind utility classes for layout and spacing.
- Use `cn` from `src/lib/utils.ts` to compose class names.
- Keep class lists readable; prefer multiline if long.
- Do not edit `src/components/ui/*` directly unless regenerating via Shadcn.

### Error handling
- Wrap external calls in `try/catch`.
- Log server errors with `console.error` and return safe fallbacks.
- Prefer early returns for invalid inputs in API routes.
- Keep caught error messages user-safe.
- Clean up loading state in `finally` blocks.

## Data access patterns
- Use Drizzle query builders (`eq`, `and`, `sql`, `cosineDistance`).
- Favor `.insert(...).values(...).returning()` when creating records.
- Use `db.query.*` or `db.select` for reads with relations.
- Avoid raw SQL unless necessary; keep sql fragments scoped.
- Respect cascade deletes defined in schema.
- Use content hashes to detect reprocessing when applicable.

## AI / embeddings
- Load provider config via `getChatConfigFromDB()` / `getEmbeddingConfigFromDB()`.
- Avoid hardcoding model IDs; rely on settings or env defaults.
- Use `generateEmbeddingsWithCache` for batched embedding work.
- Keep graph vs retrieval embeddings separate.

## UI data flow
- Server actions handle DB mutations; API routes handle streaming.
- For chat, use `@ai-sdk/react` and `DefaultChatTransport`.
- Prefer `useState` + `useEffect` patterns seen in `src/app/chat/page.tsx`.

## Documentation & configs
- `README.md` and `CLAUDE.md` contain architecture and workflow notes.
- No Cursor rules (`.cursor/rules/` or `.cursorrules`) found.
- No Copilot instructions (`.github/copilot-instructions.md`) found.

## When adding features
- Update schema in `src/db/schema.ts` then run DB scripts.
- Keep migrations small and focused.
- Add new server actions under `src/actions`.
- Keep API route responses typed and consistent.

## Quality checks before PR
- Run `npm run lint`.
- Run `npm run build` for production checks if time allows.
- Verify DB changes with `npm run db:studio`.
- Manually validate UI flows touched by the change.

## Notes for agents
- Avoid touching generated files in `src/components/ui/`.
- Keep changes minimal and aligned with nearby patterns.
- Ask for clarification when behavior is ambiguous.
- Do not add new tooling without explicit request.
- Do not add tests unless a suite exists.

## Single-file references (examples)
- Lint a page: `npx next lint --file src/app/library/page.tsx`.
- Lint an API route: `npx next lint --file src/app/api/ingest/route.ts`.
- Lint a server action: `npx next lint --file src/actions/ingest.ts`.

## Network/services
- Local DB runs on Docker; default port mapping `localhost:5432`.
- Ollama defaults to `http://localhost:11434/v1`.
- App runs at `http://localhost:3000`.

## End
