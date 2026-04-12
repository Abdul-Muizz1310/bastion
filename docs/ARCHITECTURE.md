# Architecture

```mermaid
graph TD
    A[Browser] --> B[Next.js App Router]
    B --> C[Server Actions]
    C --> D[Drizzle ORM]
    D --> E[Neon Postgres]
    C --> F[iron-session]
    C --> G[API Gateway /api/proxy]
    G --> H[Downstream Services]
```

TODO: expand after implementation
