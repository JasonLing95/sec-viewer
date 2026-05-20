import os

# Ensure Vercel's read-only file system doesn't crash the edgar cache
os.environ["EDGAR_LOCAL_DATA_DIR"] = "/tmp"

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from edgar import set_identity, get_filings, get_by_accession_number

app = FastAPI()


# Endpoint 1: The Screener Front Page (List of Funds)
@app.get("/api/filings")
def get_recent_filings():
    set_identity("data-pipeline@company.com")
    try:
        # Fetch the metadata for the 50 newest 13F-HR filings
        filings = get_filings(form="13F-HR").latest(50)

        results = []
        for filing in filings:
            results.append(
                {
                    "company": filing.company,
                    "cik": filing.cik,
                    "date": str(filing.filing_date),
                    "accession_no": filing.accession_no,
                }
            )

        return JSONResponse(content={"filings": results})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


# Endpoint 2: The Deep Dive (Stock Holdings for a specific fund)
@app.get("/api/holdings/{accession_no}")
def get_holdings(accession_no: str):
    set_identity("data-pipeline@yourdomain.com")
    try:
        # Fetch the specific filing the user clicked on
        filing = get_by_accession_number(accession_no)
        thirteen_f = filing.obj()
        holdings_df = thirteen_f.infotable

        processed_holdings = []
        for _, row in holdings_df.iterrows():
            processed_holdings.append(
                {
                    "ticker": row.get("nameOfIssuer", "N/A"),
                    "cusip": row.get("cusip", "N/A"),
                    "shares": row.get("sshPrnamt", 0),
                    "value_usd": row.get("value", 0),
                    "class": row.get("titleOfClass", "N/A"),
                }
            )

        return JSONResponse(
            content={"company": filing.company, "holdings": processed_holdings[:100]}
        )
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})
