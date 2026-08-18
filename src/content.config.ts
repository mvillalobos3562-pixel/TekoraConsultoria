import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    publishDate: z.date(),
    relatedLine: z.enum(['costos', 'inventarios']),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
