# Moniq Terminal: SEC Filing Screener & Analyzer

Moniq Terminal is a high-performance, AI-powered web application for searching, viewing, and analyzing SEC filings. It parses complex XBRL and SGML data directly from the SEC EDGAR database to provide clean, actionable financial intelligence.

Powered by **FastAPI** and **Llama 3.3** (via Groq), it features real-time 13F-HR portfolio breakdowns, 10-K/10-Q financial extraction, 5-year trend tracking, and instant AI summarization of dense financial documents.

---

# 🌐 Live Web App

## Production Deployment

**Live Application:**  
https://sec-viewer-six.vercel.app/

Access the deployed platform directly in your browser to:

- Search SEC filings in real time
- Analyze institutional 13F portfolios
- View structured 10-K / 10-Q financials
- Generate AI-powered filing summaries
- Explore narrative sections interactively
- Track insider trades and recent filings

---

# ✨ Key Features

## 📊 13F-HR Portfolio Analysis

Instantly parses institutional holdings and calculates:

- Total AUM
- Top 10 Concentration
- Options Ratio (Leverage)
- Quarter-over-Quarter Turnover
- Historical portfolio positioning

---

## 🏢 Corporate Financials (10-K & 10-Q)

Extracts and structures:

- Income Statements
- Balance Sheets
- Cash Flow Statements

Includes dynamically generated:

- 5-Year SVG Sparkline Trends
- Financial metric comparisons
- Historical trend visualization

---

## 🤖 AI-Powered Insights

Integrates **Groq's Llama-3.3-70b** model for:

- Portfolio strategy summaries
- Financial statement interpretation
- Risk signal extraction
- Management narrative analysis
- Filing simplification for rapid review

---

## 📚 Narrative Explorer

Breaks down lengthy SEC filings into an interactive chapter structure, including:

- Part I — Business
- Risk Factors
- MD&A (Management Discussion & Analysis)
- Financial Statements
- Notes to Financial Statements

---

## ⚡ Real-Time Filing Feeds

Auto-refreshing global feeds for:

- 13F-HR Filings
- 10-K / 10-Q Corporate Filings
- Insider Trades (Form 4)
- Private Offerings (Form D)

---

## 🔍 Lightning Fast Search

Vectorized ticker and CIK substring searching powered by:

- Apache Parquet lookup files
- In-memory filtering
- Lightweight local indexing

---

# 🖥 Screens & Views

The deployed web application includes:

## Home Dashboard

- Global filing feed
- Search interface
- Recent institutional filings
- Trending corporate disclosures

## Filing Viewer

- Parsed SEC filing content
- Structured section navigation
- Interactive narrative explorer

## Financial Statements View

- Clean XBRL extraction
- Structured financial tables
- Trend sparklines

## Portfolio Analytics View

- Holdings breakdown
- Sector concentration
- Position-level analysis
- Turnover metrics

## AI Summary Panels

- Instant LLM-generated summaries
- Key insights extraction
- Filing interpretation assistance

---

# 🛠 Tech Stack

## Backend

- **Python / FastAPI** — High-speed asynchronous API framework
- **edgartools** — SEC EDGAR querying & XBRL extraction
- **Pandas** — Financial data processing
- **lxml** — XML and SGML parsing
- **Groq API** — Ultra-low latency LLM inference
- **Supabase** — PostgreSQL-backed filings feed storage

---

## Frontend

- **Vanilla HTML / CSS / JavaScript** — Zero-build-step architecture
- **Marked.js** — Markdown rendering
- **Browser History API** — Deep-linkable filing navigation

---

## Infrastructure

- **Vercel** — Serverless deployment platform
- **Python Serverless Functions** — Backend execution layer
- **vercel.json** — Deployment configuration

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

For ultra-fast ticker and company-name lookups, add:

```plaintext
ct.pq            # CUSIP → Ticker mapping
cik-lookup.pq    # Company Name → CIK mapping
```

If these files are unavailable, the application falls back to native SEC identifiers.

---

## 6. Run the Local Development Server

```bash
uvicorn api.index:app --reload --port 8000
```

Open:

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
│   └── app.js             # Client-side routing & API calls
│
├── .env                   # Environment variables
├── requirements.txt       # Python dependencies
└── vercel.json            # Vercel deployment configuration
```

---

# 📝 API Endpoints Overview

## Global Search

```http
GET /api/search?q={query}
```

Search by:

- Company name
- Ticker
- CIK

---

## 13F Holdings Parser

```http
GET /api/holdings/{accession_no}
```

Parses 13F-HR XML filings and calculates:

- QoQ deltas
- Concentration metrics
- Turnover
- Leverage exposure

---

## Financial Statement Extraction

```http
GET /api/financials/{accession_no}
```

Transforms raw XBRL filing data into structured JSON statements.

---

## Narrative Explorer

```http
GET /api/narrative/{accession_no}
```

Slices long-form SEC filing text into structured chapters.

---

## AI Portfolio Summary

```http
POST /api/summarize-portfolio
```

Generates strategic portfolio summaries using Llama 3.3.

---

## AI Financial Statement Summary

```http
POST /api/summarize-statement
```

Creates AI-generated insights from XBRL financial tables.

---

## AI Narrative Summary

```http
POST /api/summarize-narrative
```

Summarizes qualitative filing sections and disclosures.

---

## Hold Time Metrics

```http
POST /api/metrics/holdtime
```

Calculates estimated average hold time for top positions using historical SEC filings.

---

# ⚙ Deployment

## Vercel Deployment

The application is optimized for deployment on Vercel using Python Serverless Functions.

Example deployment flow:

```bash
vercel deploy
```

Configuration is handled via:

```plaintext
vercel.json
```

---

# 📌 Highlights

- AI-powered SEC filing analysis
- Real-time EDGAR parsing
- Structured XBRL extraction
- Institutional portfolio intelligence
- Zero-build frontend architecture
- FastAPI serverless backend
- Deep-linkable filing navigation
- Interactive financial trend tracking
- Groq LLM integration
- Lightning-fast Parquet search indexing

---

# 🔐 Environment Variables

| Variable | Description |
|---|---|
| `GROQ_API_KEY` | API key for Groq LLM inference |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_KEY` | Supabase anon/public key |

---

# 📄 License

MIT License

---

# 🙌 Acknowledgements

- SEC EDGAR
- FastAPI
- Groq
- Supabase
- Pandas
- Vercel
- edgartools
- lxml

---

# 🔗 Quick Access

## Live Web App

https://sec-viewer-six.vercel.app/

## Local Development

```bash
uvicorn api.index:app --reload --port 8000
```