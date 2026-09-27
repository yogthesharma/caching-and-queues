export default async function statsRoutes(app) {
  app.get('/stats', {
    schema: {
      summary: 'Cache counters for this process (reset on restart)',
      tags: ['stats'],
      response: {
        200: {
          description: 'Counters since the process started',
          type: 'object',
          properties: {
            l1Hits: { type: 'integer' },
            l2Hits: { type: 'integer' },
            misses: { type: 'integer' },
            lookups: { type: 'integer' },
            hitRate: { type: ['number', 'null'], description: '(l1Hits + l2Hits) / lookups; null before the first lookup' },
            dbQueries: { type: 'integer', description: 'Reads and writes that reached the database' },
            l1Size: { type: 'integer', description: 'Entries currently in this process’s L1' },
          },
        },
      },
    },
  }, async () => app.products.getStats());
}
