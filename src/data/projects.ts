export type Project = { name: string; status: "已发布" | "实验中" | "学习项目"; summary: string; stack: string[]; href: string };
export const projects: Project[] = [
  { name: "DermAI", status: "已发布", summary: "把皮肤图像识别与 RAG 问答放在同一个原型中，探索视觉结果如何辅助后续咨询。", stack: ["Python", "CV", "RAG"], href: "https://github.com/dqyydq/DermAI" },
  { name: "ASR-HANDLER", status: "已发布", summary: "面向中文播客的转写与说话人分离应用，尝试把模型能力整理成可使用的 Web 服务。", stack: ["FunASR", "FastAPI", "React"], href: "https://github.com/dqyydq/ASR-HANDLER" },
  { name: "recommend-bili", status: "实验中", summary: "整理 B 站收藏内容的 Agent 工具，减少翻找与归类的重复劳动。", stack: ["Python", "Agent"], href: "https://github.com/dqyydq/recommend-bili" },
  { name: "pytorch-melanoma-kd", status: "学习项目", summary: "围绕医学图像长尾分类，练习知识蒸馏与生成式数据增强。", stack: ["PyTorch", "StarGAN v2"], href: "https://github.com/dqyydq/pytorch-melanoma-kd" },
];
