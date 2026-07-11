import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ base: "./src/content/blog", pattern: "**/*.md" }),
  schema: z.object({
    title: z.string(), description: z.string(), pubDate: z.coerce.date(),
    type: z.enum(["学习日志", "源码解读", "项目复盘"]), tags: z.array(z.string()).min(1), featured: z.boolean().default(false),
  }),
});
export const collections = { blog };
