export type Service = {
  id: string;
  name: string;
  role: string;
  repoUrl: string;
  backendUrl: string;
  frontendUrl: string;
  healthPath: string;
  versionPath: string;
  metricsPath: string;
  tags: string[];
};

export const SERVICES: Service[] = [
  {
    id: "paper-trail",
    name: "Paper Trail",
    role: "LangGraph multi-agent debater",
    repoUrl: "https://github.com/Abdul-Muizz1310/paper-trail-backend",
    backendUrl: "https://paper-trail-backend.onrender.com",
    frontendUrl: "https://paper-trail-frontend.vercel.app",
    healthPath: "/health",
    versionPath: "/version",
    metricsPath: "/metrics",
    tags: ["langgraph", "agents", "rag"],
  },
  {
    id: "inkprint",
    name: "Inkprint",
    role: "Content provenance + training-data leak detection",
    repoUrl: "https://github.com/Abdul-Muizz1310/inkprint-backend",
    backendUrl: "https://inkprint-backend.onrender.com",
    frontendUrl: "https://inkprint-frontend.vercel.app",
    healthPath: "/health",
    versionPath: "/version",
    metricsPath: "/metrics",
    tags: ["c2pa", "pgvector", "signing"],
  },
  {
    id: "slowquery",
    name: "Slowquery Detective",
    role: "Slow query catcher + index suggester",
    repoUrl: "https://github.com/Abdul-Muizz1310/slowquery-detective",
    backendUrl: "https://slowquery-demo-backend.onrender.com",
    frontendUrl: "https://slowquery-dashboard-frontend.vercel.app",
    healthPath: "/health",
    versionPath: "/version",
    metricsPath: "/metrics",
    tags: ["postgres", "performance"],
  },
  {
    id: "magpie",
    name: "Magpie",
    role: "YAML scrapers that self-heal via LLM + PR",
    repoUrl: "https://github.com/Abdul-Muizz1310/magpie-backend",
    backendUrl: "https://magpie-backend-izzu.onrender.com",
    frontendUrl: "https://magpie-frontend-three.vercel.app",
    healthPath: "/health",
    versionPath: "/version",
    metricsPath: "/metrics",
    tags: ["scraping", "llm", "self-heal"],
  },
  {
    id: "feathers",
    name: "Feathers",
    role: "FastAPI service scaffolder (CLI, no hosted backend)",
    repoUrl: "https://github.com/Abdul-Muizz1310/feathers",
    backendUrl: "",
    frontendUrl: "",
    healthPath: "",
    versionPath: "",
    metricsPath: "",
    tags: ["cli", "scaffolder"],
  },
];
