---
layout: default
title: "Data Sources Reference"
---

# 信息源参考库

> 所有调研过的信息源备用库。标注优先级和接入状态，后续替换或扩充时直接查阅。

## 已接入（7个）

| 信息源 | 类型 | 接入方式 |
|--------|------|---------|
| Google Trends | 趋势 | 抓取 |
| TechCrunch / The Verge / Ars Technica / Wired / VentureBeat / MIT Tech Review / TNW | 科技媒体 RSS | RSS |
| Product Hunt | 产品发布 | RSS |
| Twitter/X | 社交趋势 | API |
| GitHub Trending | 开源趋势 | 抓取 |
| Hacker News | 极客社区 | API |
| Reddit | 社区讨论 | 抓取 |

---

## 计划新增 — 第一批：核心5个

| 信息源 | 价值 | 接入方式 | 状态 |
|--------|------|---------|------|
| YouTube 搜索建议 | 用户搜教程 = 有痛点且愿意花时间 | YouTube Data API v3（免费配额） | 待开发 |
| Google People Also Ask | 长尾关键词 + 用户真实疑问 | 搜索结果提取 | 待开发 |
| 知乎热榜 | 中文市场用户直接提问 | RSSHub `/zhihu/hot` 或 api.vvhan.com | 待开发 |
| Chrome 扩展商店热门/新品 | 有人做扩展 = 需求已验证 | 抓取 chrome.google.com/webstore | 待开发 |
| IndieHackers | 同行在做什么、赚多少 | RSS / 抓取 | 待开发 |

## 计划新增 — 第二批：验证5个

| 信息源 | 价值 | 接入方式 | 状态 |
|--------|------|---------|------|
| Gumroad 热销 | 独立开发者已验证的变现路径 | 抓取 gumroad.com/discover | 待开发 |
| Exploding Topics | 量化增长趋势，比 Google Trends 更精准 | 抓取 explodingtopics.com | 待开发 |
| Techmeme | 算法聚合最热科技讨论，信噪比极高 | RSS `https://www.techmeme.com/feed.xml` | 待开发 |
| BestBlogs.dev | 400+ 源已做 AI 评分(0-100) | RSS `https://www.bestblogs.dev` | 待开发 |
| Quora 热门 | 英文市场用户直接提问 | 抓取 | 待开发 |

## 计划新增 — 第三批：中文市场5个

| 信息源 | 价值 | 接入方式 | 状态 |
|--------|------|---------|------|
| 36Kr 热榜 | 中文科技/创业生态 | RSSHub `/36kr/hot-list/renqi` | 待开发 |
| 微博热搜 | 大众消费趋势 | RSSHub `/weibo/search/hot` 或 api.vvhan.com | 待开发 |
| Bilibili 热门 | Z世代内容趋势 | Bilibili API | 待开发 |
| 掘金热榜 | 中文开发者社区趋势 | RSSHub `/juejin/trending/all/weekly` | 待开发 |
| 小红书 | 种草需求，消费决策 | 抓取（反爬较严，优先级低） | 待开发 |

---

## 备用库 — 高质量 RSS 源

### AI / 科技策展

| 信息源 | RSS | 备注 |
|--------|-----|------|
| Latent Space | `https://www.latent.space/feed` | AI 产品趋势风向标 |
| Simon Willison's Weblog | `https://simonwillison.net/atom/everything/` | LLM 应用实践第一人 |
| One Useful Thing (Ethan Mollick) | `https://www.oneusefulthing.org/feed` | 沃顿教授 AI 实用场景 |
| Interconnects | `https://www.interconnects.ai/feed` | AI 工程深度思考 |
| Last Week in AI | `https://lastweekin.ai/feed` | 周刊 AI 摘要 |
| The Rundown AI | `https://rss.beehiiv.com/feeds/2R3C6Bt5wj.xml` | 日更 AI 新闻 |
| AI Snake Oil | `https://aisnakeoil.substack.com/feed` | AI 炒作批判（有助过滤噪音） |
| Ahead of AI (Sebastian Raschka) | `https://magazine.sebastianraschka.com/feed` | ML 研究前沿 |
| THE DECODER | `https://the-decoder.com/feed/` | AI 新闻 |
| SemiAnalysis | `https://www.semianalysis.com/feed` | 半导体 + AI 硬件分析 |
| Chain of Thought (Every) | `https://every.to/chain-of-thought/feed.xml` | AI 实验与应用 |
| Crunchbase News | `https://news.crunchbase.com/feed` | 融资数据，市场信号 |

### 开发者社区

| 信息源 | RSS | 备注 |
|--------|-----|------|
| DEV Community | `https://dev.to/feed` | 开发者讨论 |
| InfoQ AI/ML | `https://feed.infoq.com/ai-ml-data-eng/` | 企业开发者趋势 |
| The New Stack | `https://thenewstack.io/feed` | 云原生趋势 |
| Stack Overflow Blog | `https://stackoverflow.blog/feed/` | 开发者工具趋势 |
| KDnuggets | `https://www.kdnuggets.com/feed` | 数据科学行业 |
| LangChain Blog | `https://blog.langchain.dev/rss/` | AI 框架生态 |
| 404 Media | `https://www.404media.co/rss` | 独立调查科技新闻 |

### 科技媒体（备选替换）

| 信息源 | RSS | 备注 |
|--------|-----|------|
| Bloomberg Technology | `https://feeds.bloomberg.com/technology/news.rss` | 科技商业信号 |
| IEEE Spectrum (AI) | `https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss` | 工程级 AI 报道 |
| SiliconANGLE (AI) | `https://siliconangle.com/category/ai/feed` | 企业级科技 |
| Sifted | `https://sifted.eu/feed/?post_type=article` | 欧洲创业生态 |
| Rest of World | `https://restofworld.org/feed/latest` | 非西方科技市场 |
| Synced Review | `https://syncedreview.com/feed` | AI 技术评论（偏中国） |

### 中文平台（备选）

| 信息源 | RSSHub 路由 / API | 备注 |
|--------|-------------------|------|
| 虎嗅 | `/huxiu/channel` | 中文科技商业分析 |
| 第一财经 | `/yicai/headline` | 财经/商业新闻 |
| 百度热议 | api.vvhan.com | 搜索引擎趋势 |
| 抖音热榜 | api.vvhan.com | 短视频趋势 |
| 豆瓣热门 | api.vvhan.com | 文化/产品讨论 |
| 小宇宙播客 | RSSHub | 播客趋势 |

### 趋势检测平台

| 信息源 | URL | 备注 |
|--------|-----|------|
| Trendshift.io | https://trendshift.io/ | GitHub 趋势替代品，评分更一致 |
| Glimpse | https://meetglimpse.com/ | 绝对搜索量 + 增长率 |
| Rising Trends | https://www.risingtrends.co/ | 多渠道信号：Google、TikTok、Reddit、Amazon |
| Trends.vc | https://trends.vc/ | 创业市场趋势报告 |
| Answer Socrates | https://answersocrates.com/ | PAA 数据聚合 |

### 研究/学术（不建议接入，仅备查）

| 信息源 | RSS | 备注 |
|--------|-----|------|
| arXiv cs.CL | `https://arxiv.org/rss/cs.CL` | NLP 论文，离产品远 |
| arXiv cs.LG | `https://arxiv.org/rss/cs.LG` | ML 论文 |
| Google AI Blog | `http://googleaiblog.blogspot.com/atom.xml` | Google AI 发布 |
| OpenAI Blog | `https://openai.com/blog/rss/` | OpenAI 产品/研究 |
| Anthropic Blog | `https://www.anthropic.com/rss.xml` | AI 安全研究 |
| Hugging Face Blog | `https://huggingface.co/blog/feed.xml` | 开源 ML 模型发布 |
| DeepMind Blog | `https://deepmind.com/blog/feed/basic/` | DeepMind 研究 |

---

## 参考项目

| 项目 | 地址 | 说明 |
|------|------|------|
| foorilla/allainews_sources | https://github.com/foorilla/allainews_sources | 130+ AI/ML 信息源列表 |
| DIYgod/RSSHub | https://github.com/DIYgod/RSSHub | 万能 RSS 代理，5000+ 路由 |
| wopal-cn/mcp-hotnews-server | https://github.com/wopal-cn/mcp-hotnews-server | 9个中文平台热榜 MCP 服务 |
| finaldie/auto-news | https://github.com/finaldie/auto-news | 个人新闻聚合器（Tweets+RSS+YouTube+Reddit） |
| justlovemaki/CloudFlare-AI-Insight-Daily | https://github.com/justlovemaki/CloudFlare-AI-Insight-Daily | Cloudflare Workers AI 日报系统 |
| Freelander/AI-Daily | https://github.com/Freelander/AI-Daily | GoJun AI 日报（中英双语） |
| AboutRSS/ALL-about-RSS | https://github.com/AboutRSS/ALL-about-RSS | RSS 工具/服务/社区大全 |
| plenaryapp/awesome-rss-feeds | https://github.com/plenaryapp/awesome-rss-feeds | ~500 推荐 RSS 源 + OPML |
| JackyST0/awesome-rsshub-routes | https://github.com/JackyST0/awesome-rsshub-routes | RSSHub 精选路由集合 |
| mezod/awesome-indie | https://github.com/mezod/awesome-indie | 独立开发者赚钱资源 |
