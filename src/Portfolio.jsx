import { useEffect, useRef, useState } from "react";
import { Github, Mail, ArrowUpRight, Cpu, Radio } from "lucide-react";

/* ---------- Design tokens ----------
Background : #F7F8FA  (cool off-white, not the cliché cream)
Surface    : #FFFFFF
Ink        : #12172B  (near-black navy, primary text)
Muted      : #6B7280
Accent     : #3452E1  (signal blue — nods to electronics/信号处理背景)
Accent-2   : #0FBF9F  (mint — secondary, used sparingly on tags)
Line       : #E6E8EE
Display font : Space Grotesk (geometric, technical)
Body font    : Inter
Mono font    : JetBrains Mono (used for tags / labels — code register)
Signature element: an animated oscilloscope-style waveform under the hero
name — ties together his signal-processing background (电子信息工程) and
his audio project (ASR-HANDLER) without being decorative filler.
------------------------------------- */

const skills = [
  {
    group: "AI / 机器学习",
    items: ["Python", "PyTorch", "知识蒸馏", "GAN (StarGAN v2)", "RAG"],
  },
  {
    group: "语音 & 多模态",
    items: ["FunASR", "pyannote.audio", "语音识别", "说话人分离"],
  },
  {
    group: "后端 & 工程",
    items: ["FastAPI", "Git / GitHub", "数据处理", "系统集成"],
  },
];

const projects = [
  {
    name: "DermAI",
    tag: "CV + RAG",
    desc: "融合计算机视觉诊断模型与文本知识库的 RAG 皮肤问诊系统,让视觉识别结果和语言模型问答联动,辅助皮肤病初步识别与咨询。",
    stack: ["Python", "RAG", "CV"],
    link: "https://github.com/dqyydq/DermAI",
  },
  {
    name: "pytorch-melanoma-kd",
    tag: "医学影像分类",
    desc: "针对 ISIC 2019 黑色素瘤分类中的类别不平衡问题,结合知识蒸馏与 StarGAN v2 生成式数据增强,提升少数类别的识别效果。",
    stack: ["PyTorch", "知识蒸馏", "StarGAN v2"],
    link: "https://github.com/dqyydq/pytorch-melanoma-kd",
  },
  {
    name: "ASR-HANDLER",
    tag: "全栈语音应用",
    desc: "面向中文播客的语音转写与说话人分离 Web 应用,基于 FunASR + pyannote.audio 完成核心能力,FastAPI + React 搭建全栈服务。",
    stack: ["FunASR", "pyannote.audio", "FastAPI", "React"],
    link: "https://github.com/dqyydq/ASR-HANDLER",
  },
  {
    name: "recommend-bili",
    tag: "Agent 工具",
    desc: "一个自动整理 B 站收藏夹内容的智能 Agent,按主题和优先级归类,减少手动翻找收藏的成本。",
    stack: ["Python", "Agent"],
    link: "https://github.com/dqyydq/recommend-bili",
  },
];

function useReveal() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, visible];
}

function Waveform() {
  return (
    <svg
      width="220"
      height="28"
      viewBox="0 0 220 28"
      fill="none"
      style={{ display: "block", marginTop: "10px" }}
    >
      <path
        d="M0 14 L14 14 L20 4 L28 24 L36 8 L44 20 L52 14 L64 14 L70 6 L78 22 L86 10 L94 18 L102 14 L114 14 L120 4 L128 24 L136 8 L144 20 L152 14 L164 14 L170 6 L178 22 L186 10 L194 18 L202 14 L220 14"
        stroke="#3452E1"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength="1"
        style={{
          strokeDasharray: 1,
          strokeDashoffset: 1,
          animation: "draw 2.2s ease-out forwards 0.3s",
        }}
      />
    </svg>
  );
}

function SectionLabel({ children }) {
  return (
    <div
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "12px",
        letterSpacing: "0.08em",
        color: "#6B7280",
        marginBottom: "10px",
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

export default function Portfolio() {
  const [heroIn, setHeroIn] = useState(false);
  const [skillsRef, skillsVisible] = useReveal();
  const [projectsRef, projectsVisible] = useReveal();
  const [contactRef, contactVisible] = useReveal();

  useEffect(() => {
    const t = setTimeout(() => setHeroIn(true), 60);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      style={{
        background: "#F7F8FA",
        color: "#12172B",
        fontFamily: "'Inter', sans-serif",
        minHeight: "100%",
        width: "100%",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        @keyframes draw { to { stroke-dashoffset: 0; } }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .reveal { opacity: 0; }
        .reveal.in { opacity: 1; animation: fadeUp 0.6s ease-out forwards; }
        .card-hover { transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease; }
        .card-hover:hover { transform: translateY(-3px); box-shadow: 0 12px 28px rgba(18,23,43,0.08); border-color: #3452E1; }
        .link-arrow { transition: transform 0.18s ease; }
        .proj-link:hover .link-arrow { transform: translate(2px, -2px); }
        @media (prefers-reduced-motion: reduce) {
          .reveal, .reveal.in { animation: none !important; opacity: 1 !important; }
        }
      `}</style>

      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-5 md:px-16">
        <div
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 600,
            fontSize: "16px",
          }}
        >
          邓全尧
        </div>
        <a
          href="https://github.com/dqyydq"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2"
          style={{ color: "#6B7280", fontSize: "14px", textDecoration: "none" }}
        >
          <Github size={16} />
          <span className="hidden md:inline">GitHub</span>
        </a>
      </div>

      {/* Hero */}
      <section className="px-6 md:px-16 pt-16 pb-20 md:pt-24 md:pb-28">
        <div
          className="reveal in"
          style={{ maxWidth: "680px", animationDelay: "0.05s" }}
        >
          <div
            className="flex items-center gap-2"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "13px",
              color: "#3452E1",
              marginBottom: "18px",
            }}
          >
            <Radio size={14} />
            电子信息工程 · AI 应用开发
          </div>
          <h1
            style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 700,
              fontSize: "clamp(32px, 5vw, 52px)",
              lineHeight: 1.15,
              margin: 0,
              letterSpacing: "-0.01em",
            }}
          >
            用信号处理的思维,
            <br />
            做能落地的 AI 应用。
          </h1>
          <Waveform />
          <p
            style={{
              marginTop: "22px",
              fontSize: "16px",
              lineHeight: 1.7,
              color: "#4B5261",
              maxWidth: "560px",
            }}
          >
            我关注计算机视觉、语音处理与检索增强生成(RAG)在真实场景中的落地,
            做过医学影像分类、语音转写与知识问诊等方向的项目,喜欢把模糊的想法
            变成能跑起来的系统。
          </p>
          <div className="flex flex-wrap gap-3" style={{ marginTop: "28px" }}>
            <a
              href="https://github.com/dqyydq"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2"
              style={{
                background: "#12172B",
                color: "#fff",
                padding: "10px 18px",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              <Github size={16} />
              查看 GitHub
            </a>
            <a
              href="#contact"
              className="flex items-center gap-2"
              style={{
                border: "1px solid #E6E8EE",
                color: "#12172B",
                padding: "10px 18px",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              <Mail size={16} />
              联系我
            </a>
          </div>
        </div>
      </section>

      {/* Skills */}
      <section
        ref={skillsRef}
        className={`reveal ${skillsVisible ? "in" : ""} px-6 md:px-16 py-16`}
        style={{ borderTop: "1px solid #E6E8EE" }}
      >
        <SectionLabel>技能栈</SectionLabel>
        <div className="grid gap-8 md:grid-cols-3">
          {skills.map((group) => (
            <div key={group.group}>
              <div
                style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontWeight: 600,
                  fontSize: "15px",
                  marginBottom: "12px",
                }}
              >
                {group.group}
              </div>
              <div className="flex flex-wrap gap-2">
                {group.items.map((item) => (
                  <span
                    key={item}
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "12.5px",
                      background: "#FFFFFF",
                      border: "1px solid #E6E8EE",
                      color: "#3452E1",
                      padding: "5px 10px",
                      borderRadius: "6px",
                    }}
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Projects */}
      <section
        ref={projectsRef}
        className={`reveal ${projectsVisible ? "in" : ""} px-6 md:px-16 py-16`}
        style={{ borderTop: "1px solid #E6E8EE" }}
      >
        <SectionLabel>项目</SectionLabel>
        <div className="grid gap-5 md:grid-cols-2">
          {projects.map((p) => (
            <a
              key={p.name}
              href={p.link}
              target="_blank"
              rel="noreferrer"
              className="card-hover proj-link"
              style={{
                display: "block",
                background: "#FFFFFF",
                border: "1px solid #E6E8EE",
                borderRadius: "12px",
                padding: "22px",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div className="flex items-start justify-between">
                <div
                  style={{
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontWeight: 600,
                    fontSize: "17px",
                  }}
                >
                  {p.name}
                </div>
                <ArrowUpRight
                  className="link-arrow"
                  size={18}
                  style={{ color: "#6B7280", flexShrink: 0 }}
                />
              </div>
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "11.5px",
                  color: "#0FBF9F",
                  marginTop: "4px",
                  marginBottom: "10px",
                }}
              >
                {p.tag}
              </div>
              <p
                style={{
                  fontSize: "14px",
                  lineHeight: 1.65,
                  color: "#4B5261",
                  margin: 0,
                }}
              >
                {p.desc}
              </p>
              <div className="flex flex-wrap gap-2" style={{ marginTop: "14px" }}>
                {p.stack.map((s) => (
                  <span
                    key={s}
                    style={{
                      fontSize: "11.5px",
                      color: "#6B7280",
                      background: "#F7F8FA",
                      padding: "3px 8px",
                      borderRadius: "5px",
                    }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* Contact */}
      <section
        id="contact"
        ref={contactRef}
        className={`reveal ${contactVisible ? "in" : ""} px-6 md:px-16 py-20`}
        style={{ borderTop: "1px solid #E6E8EE" }}
      >
        <div className="flex items-center gap-2" style={{ marginBottom: "14px" }}>
          <Cpu size={16} style={{ color: "#3452E1" }} />
          <SectionLabel>联系方式</SectionLabel>
        </div>
        <h2
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 600,
            fontSize: "clamp(24px, 3.5vw, 32px)",
            margin: 0,
            maxWidth: "480px",
          }}
        >
          有想法想聊聊,或者发现了我项目里的 bug?
        </h2>
        <div className="flex flex-wrap gap-4" style={{ marginTop: "22px" }}>
          <a
            href="https://github.com/dqyydq"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2"
            style={{ color: "#12172B", fontSize: "14px", textDecoration: "none" }}
          >
            <Github size={16} /> github.com/dqyydq
          </a>
          <a
            href="mailto:dquanyao@gmail.com"
            className="flex items-center gap-2"
            style={{ color: "#12172B", fontSize: "14px", textDecoration: "none" }}
          >
            <Mail size={16} /> dquanyao@gmail.com
          </a>
        </div>
        <div
          style={{
            marginTop: "60px",
            fontSize: "12px",
            color: "#9AA1AE",
          }}
        >
          © {new Date().getFullYear()} dqy· Built with React
        </div>
      </section>
    </div>
  );
}
