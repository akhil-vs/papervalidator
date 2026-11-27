# Online Exam Paper Validator

Teachers enter marks for one class and one subject, then print a validation sheet and download a mark workbook. The app runs in the browser. Firebase Hosting serves the static build. A shared mark-book database is optional and is not required to mark a class.

## Setup

Requires Node.js 22.

```bash
npm ci
npm start
```

Open http://localhost:4200. The dev server uses `scripts/with-openssl-legacy.js` so webpack 4 can hash files on Node 22.

### Docker

```bash
cp .env.example .env
docker compose up --build
```

The app is on http://localhost:4200. To also start the mark-book database:

```bash
docker compose --profile markbook up --build
```

Postgres listens on port 5432 and loads `db/migrations` the first time its volume is created. Connect with the user, password, and database name from `.env`.

```bash
docker compose --profile markbook exec db \
  psql -U exam -d exam_validator -c "SELECT serial_label, name, marks FROM mark_list ORDER BY list_position;"
```

### Scripts

| Command                | Purpose                                       |
| ---------------------- | --------------------------------------------- |
| `npm start`            | Dev server                                    |
| `npm run build`        | Production build in `dist/resume-builder`     |
| `npm run lint`         | ESLint on the TypeScript and the Node scripts |
| `npm run lint:tslint`  | Existing Angular 9 TSLint rules               |
| `npm test`             | Unit tests                                    |
| `npm run format`       | Prettier across the repo                      |
| `npm run format:check` | Prettier on the skeleton files                |

Public build settings live in `src/environments/environment.ts`. `ng build --prod` replaces that file with `environment.prod.ts`. Secrets stay out of those files. Copy `.env.example` to `.env` for Compose variables, and do not commit `.env`.

## Top-level folders

| Folder             | Purpose                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `src`              | Angular application: the marking screen, global styles, and build-time environment files.                       |
| `src/app`          | The component, template, and in-browser models for a sitting.                                                   |
| `src/environments` | Public configuration swapped in at build time.                                                                  |
| `src/assets`       | Fonts and the class-list sample images.                                                                         |
| `e2e`              | Protractor end-to-end tests.                                                                                    |
| `scripts`          | The Node 22 wrapper that enables OpenSSL's legacy provider for the Angular 9 build.                             |
| `db`               | PostgreSQL migrations for the optional shared mark book. Compose applies them only with the `markbook` profile. |

There is no application server in this repo. Excel import, totals, print, and the workbook download happen in the browser. `db/` is the schema for a later shared mark book, ready to boot locally.

## Lint and types

ESLint uses `tsconfig.eslint.json` so it type-checks `src` and `e2e` without changing the Angular build. Prettier matches the existing style: single quotes, semicolons, 140-character lines. TSLint remains available through `npm run lint:tslint` because the Angular 9 CLI still wires its lint builder to `tslint.json`.

`tsconfig.json` targets ES2015, keeps experimental decorators, and leaves Ivy off. Those settings match Angular 9. Do not turn on `strict` as a drive-by change. It fails the current components.
