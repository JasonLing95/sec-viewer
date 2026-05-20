from fastapi import FastAPI
from fastapi.responses import JSONResponse
from edgar import set_identity, get_filings
import json

app = FastAPI()


# Vercel requires the app instance to be available at the module level
@app.get("/api/latest-13f")
def get_latest_13f():
    # edgartools requires a registered user agent (usually an email)
    set_identity("data-pipeline@yourdomain.com")

    try:
        # Fetch the most recent 13F-HR filing
        filings = get_filings(form="13F-HR").latest(1)
        if not filings:
            return {"error": "No 13F-HR filings found"}

        latest_filing = filings[0]
        thirteen_f = latest_filing.obj()

        # The infotable contains the actual stock holdings
        holdings_df = thirteen_f.infotable

        # Format the data to prioritize Ticker and CUSIP over the fund name
        processed_holdings = []
        for _, row in holdings_df.iterrows():
            processed_holdings.append(
                {
                    "ticker": row.get(
                        "nameOfIssuer", "N/A"
                    ),  # Often maps to ticker or issuer name
                    "cusip": row.get("cusip", "N/A"),
                    "shares": row.get("sshPrnamt", 0),
                    "value_usd": row.get("value", 0),
                    "class": row.get("titleOfClass", "N/A"),
                }
            )

        return JSONResponse(
            content={
                "filing_date": str(latest_filing.filing_date),
                "accession_no": latest_filing.accession_no,
                "holdings": processed_holdings[
                    :100
                ],  # Cap at 100 for serverless performance
            }
        )

    except Exception as e:
        return {"error": str(e)}
