# Moniq Terminal: SEC Filing Screener & Analyzer

Moniq Terminal is a high-performance, AI-powered web application for searching, viewing, and analyzing SEC filings. It parses complex XBRL and SGML data directly from the SEC EDGAR database to provide clean, actionable financial intelligence.

Powered by **FastAPI** and **Llama 3.3** (via Groq), it features real-time 13F-HR portfolio breakdowns, 10-K/10-Q financial extraction, 5-year trend tracking, and instant AI summarization of dense financial documents.

## 🔗 Live Demo

https://sec-viewer-six.vercel.app/

---

# ✨ Key Features

## 📊 13F-HR Portfolio Analysis
Instantly parses institutional holdings and calculates:

- Total AUM
- Top 10 Concentration
- Options Ratio (Leverage)
- Quarter-over-Quarter Turnover

## 🏢 Corporate Financials (10-K & 10-Q)
Extracts:

- Income Statements
- Balance Sheets
- Cash Flow Statements

Includes dynamically generated **5-Year SVG Sparkline Trends**.

## 🤖 AI-Powered Insights
Integrates **Groq's Llama-3.3-70b** model to generate:

- Portfolio positioning summaries
- Financial statement insights
- Management narrative analysis

## 📚 Narrative Explorer
Breaks down massive 10-K/10-Q filings into an interactive chapter index, including sections like:

- Part I
- Risk Factors
- Management Discussion & Analysis (MD&A)
- Financial Statements

## ⚡ Real-Time Tracking
Auto-refreshing global feeds for:

- 13F-HR filings
- Corporate filings
- Insider trades (Form 4)
- Private offerings (Form D)

## 🔍 Lightning Fast Search
Vectorized CIK and ticker substring searching using lightweight Apache Parquet lookup files.

---

# 🛠 Tech Stack

## Backend

- **Python / FastAPI** — High-speed asynchronous API routing
- **edgartools** — SEC EDGAR querying and XBRL extraction
- **Pandas & lxml** — XML parsing and data manipulation
- **Groq API** — Ultra-low latency LLM inference
- **Supabase** — PostgreSQL integration for filings feeds

## Frontend

- **Vanilla HTML / CSS / JavaScript** — Zero-build-step architecture
- **Marked.js** — Markdown rendering for AI summaries
- **Browser History API** — Deep-linkable filing views and routing

## Infrastructure

- **Vercel** — Python Serverless deployment via `vercel.json`

---

# 🚀 Local Development Setup

## 1. Clone the Repository

```bash
git clone https://github.com/yourusername/sec-viewer.git
cd sec-viewer
```

---

## 2. Create a Virtual Environment

### macOS / Linux

```bash
python -m venv venv
source venv/bin/activate
```

### Windows

```bash
python -m venv venv
venv\Scripts\activate
```

---

## 3. Install Dependencies

```bash
pip install -r requirements.txt
```

---

## 4. Configure Environment Variables

Create a `.env` file in the project root:

```env
GROQ_API_KEY=your_groq_api_key_here
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_anon_key
```

---

## 5. Add Optional Lookup Files

For lightning-fast ticker and company-name lookups, place these files in the root directory:

```plaintext
ct.pq            # CUSIP → Ticker mapping
cik-lookup.pq    # Company Name → CIK mapping
```

> If these files are missing, the application gracefully falls back to native SEC naming.

---

## 6. Run the Development Server

```bash
uvicorn api.index:app --reload --port 8000
```

Open your browser and navigate to:

```plaintext
http://localhost:8000
```

---

# 📁 Project Structure

```plaintext
├── api/
│   └── index.py           # Main FastAPI backend & SEC parsing logic
│
├── public/
│   ├── index.html         # Main UI layout & templates
│   └── app.js             # Client-side routing, state management & API calls
│
├── .env                   # Environment variables (not tracked in git)
├── requirements.txt       # Python dependencies
└── vercel.json            # Vercel deployment configuration
```

---

# 📝 API Endpoints Overview

## Search

```http
GET /api/search?q={query}
```

Global company / ticker / CIK search.

---

## 13F Holdings Parser

```http
GET /api/holdings/{accession_no}
```

Parses 13F-HR XML filings and calculates:

- QoQ deltas
- Concentration metrics
- Portfolio turnover
- Leverage statistics

---

## Financial Statement Extraction

```http
GET /api/financials/{accession_no}
```

Extracts raw XBRL filing data into structured JSON financial statements.

---

## Narrative Explorer

```http
GET /api/narrative/{accession_no}
```

Slices 10-K / 10-Q text into a readable chapter index.

---

## AI Portfolio Summary

```http
POST /api/summarize-portfolio
```

Sends dense 13F portfolio data to **Llama 3.3** for strategic analysis.

---

## AI Financial Statement Summary

```http
POST /api/summarize-statement
```

Generates AI-driven financial insights from selected XBRL statement data.

---

## AI Narrative Summary

```http
POST /api/summarize-narrative
```

Summarizes qualitative SEC filing text using LLM inference.

---

## Hold Time Metrics

```http
POST /api/metrics/holdtime
```

Calculates the estimated average hold time for top portfolio positions using historical SEC filings.

---

# 📌 Highlights

- Zero-build frontend architecture
- Real-time SEC parsing
- AI-powered financial intelligence
- Structured XBRL extraction
- Institutional portfolio analytics
- Deep-linkable filing navigation
- Ultra-fast search with Apache Parquet
- Serverless deployment-ready

---

# 🙌 Acknowledgements

- SEC EDGAR
- FastAPI
- Groq
- Supabase
- edgartools
- Pandas
- Vercel