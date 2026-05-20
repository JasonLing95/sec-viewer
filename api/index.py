import os

os.environ["EDGAR_LOCAL_DATA_DIR"] = "/tmp"

from fastapi import FastAPI
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from edgar import set_identity, get_filings, get_by_accession_number, Company
from lxml import etree

from groq import Groq
from pydantic import BaseModel
from typing import List, Optional
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

groq_client = Groq()


class SummaryRequest(BaseModel):
    company_name: str
    holdings: List[dict]
    user_prompt: Optional[str] = (
        "Provide a high-level summary of this portfolio's top holdings, major directional bets, and options positioning."
    )


@app.post("/api/summarize-portfolio")
def summarize_portfolio(data: SummaryRequest):
    try:
        # 1. Convert the JSON holdings array into a dense text format for the LLM
        # This reduces tokens and keeps processing fast
        dense_portfolio_text = ""
        for h in data.holdings[:200]:  # Cap at top 200 rows to optimize context limits
            opt_str = f" [{h['put_call']}]" if h["put_call"] != "NONE" else ""
            dense_portfolio_text += f"Ticker: {h['ticker']}{opt_str} | Value: ${h['value_usd']}k | Shares: {h['shares']} | Type: {h['share_type']}\n"

        # 2. Build the structural engineering prompt
        system_instructions = (
            f"You are an expert financial analyst examining the latest 13F-HR regulatory SEC filing for {data.company_name}.\n"
            "Analyze the data provided. Be concrete, specific, and prioritize listing notable stock tickers, "
            "large dollar movements, and option leverage (puts/calls). Keep formatting clean and dense like Finviz."
        )

        # 3. Fire the request to Groq using the Llama-3.3 model
        completion = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": system_instructions},
                {
                    "role": "user",
                    "content": f"{data.user_prompt}\n\nHere is the raw portfolio data:\n{dense_portfolio_text}",
                },
            ],
            model="llama-3.3-70b-versatile",
            temperature=0.2,  # Low temperature keeps financial facts highly stable
        )

        return JSONResponse(content={"summary": completion.choices[0].message.content})

    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


def gather_holdings_using_lxml(tables, ns, cik, accession_number) -> list[list]:
    holdings = []
    for table in tables:
        raw_name = table.xpath("string(ns:nameOfIssuer)", namespaces=ns).strip()
        clean_name = " ".join(raw_name.split()) if raw_name else None
        cusip = table.xpath("string(ns:cusip)", namespaces=ns).strip()
        title_of_class = table.xpath("string(ns:titleOfClass)", namespaces=ns).strip()
        value = int(float(table.xpath("string(ns:value)", namespaces=ns).strip() or 0))
        shares_amount = int(
            float(
                table.xpath(
                    "string(ns:shrsOrPrnAmt/ns:sshPrnamt)", namespaces=ns
                ).strip()
                or 0
            )
        )
        share_type = (
            table.xpath("string(ns:shrsOrPrnAmt/ns:sshPrnamtType)", namespaces=ns)
            .strip()
            .upper()
        )
        if share_type not in ["SH", "PRN", ""]:
            share_type = "SH"
        investment_discretion = (
            table.xpath("string(ns:investmentDiscretion)", namespaces=ns)
            .strip()
            .upper()
        )
        put_call = (
            table.xpath("string(ns:putCall)", namespaces=ns).strip().upper() or "NONE"
        )
        sole = int(
            float(
                table.xpath("string(ns:votingAuthority/ns:Sole)", namespaces=ns).strip()
                or 0
            )
        )
        shared = int(
            float(
                table.xpath(
                    "string(ns:votingAuthority/ns:Shared)", namespaces=ns
                ).strip()
                or 0
            )
        )
        none = int(
            float(
                table.xpath("string(ns:votingAuthority/ns:None)", namespaces=ns).strip()
                or 0
            )
        )

        holdings.append(
            [
                cik,
                accession_number,
                shares_amount,
                value,
                title_of_class,
                share_type,
                investment_discretion,
                put_call,
                sole,
                shared,
                none,
                clean_name,
                cusip,
            ]
        )
    return holdings


@app.get("/api/filings")
def get_recent_filings(page: int = 1):
    set_identity("data-pipeline@yourdomain.com")
    try:
        limit = 50
        start = (page - 1) * limit
        all_latest = get_filings(form="13F-HR").latest(start + limit)
        page_filings = all_latest[start : start + limit]

        results = []
        for filing in page_filings:
            results.append(
                {
                    "company": filing.company,
                    "cik": filing.cik,
                    "date": str(filing.filing_date),
                    "accession_no": filing.accession_no,
                }
            )
        return JSONResponse(content={"filings": results, "page": page})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/holdings/{accession_no}")
def get_holdings(accession_no: str):
    set_identity("data-pipeline@yourdomain.com")
    try:
        filing = get_by_accession_number(accession_no)

        # 1. Fetch recent filings and company details
        recent_list = []
        company_details = {
            "fiscal_year": "N/A",
            "incorporated": "N/A",
            "phone": "N/A",
            "address": "N/A",
            "category": "N/A",
        }

        try:
            comp = Company(filing.cik)

            # Safely extract the new company details
            company_details["fiscal_year"] = getattr(comp, "fiscal_year_end", "N/A")
            company_details["incorporated"] = getattr(
                comp, "state_of_incorporation", "N/A"
            )
            company_details["phone"] = getattr(comp, "phone", "N/A")
            company_details["category"] = getattr(comp, "business_category", "N/A")

            # The address is usually an object in edgartools, so we stringify it if it exists
            biz_address = getattr(comp, "business_address", None)
            if biz_address:
                # Extract street, city, state, zip cleanly
                address_parts = [
                    getattr(biz_address, "street1", ""),
                    getattr(biz_address, "city", ""),
                    getattr(biz_address, "state_or_country", ""),
                    getattr(biz_address, "zipcode", ""),
                ]
                # Filter out empty strings and join with commas
                company_details["address"] = ", ".join(filter(None, address_parts))

            # Fetch the 12 most recent 13F-HRs
            recent_filings = comp.get_filings(form="13F-HR").latest(12)
            for rf in recent_filings:
                recent_list.append(
                    {"accession_no": rf.accession_no, "date": str(rf.filing_date)}
                )
        except Exception as e:
            print(f"Metadata extraction failed: {e}")  # Failsafe

        cik_stripped = str(filing.cik).lstrip("0")
        acc_no_stripped = accession_no.replace("-", "")
        sec_index_url = f"https://www.sec.gov/Archives/edgar/data/{cik_stripped}/{acc_no_stripped}/{accession_no}-index.html"

        xml_text = None
        sec_xml_url = "#"
        for att in filing.attachments:
            if (
                "infotable" in att.document.lower()
                or "INFORMATION TABLE" in att.document_type.upper()
            ):
                xml_text = att.text()
                # Grab the direct URL to the XML file if edgartools has it, otherwise construct a fallback
                sec_xml_url = getattr(
                    att,
                    "url",
                    f"https://www.sec.gov/Archives/edgar/data/{cik_stripped}/{acc_no_stripped}/{att.document}",
                )
                break

        if not xml_text:
            return JSONResponse(
                status_code=404, content={"error": "Information table XML not found."}
            )

        root = etree.fromstring(xml_text.encode("utf-8"))
        ns = {"ns": "http://www.sec.gov/edgar/document/thirteenf/informationtable"}
        tables = root.xpath("//ns:infoTable", namespaces=ns)
        holdings_list = gather_holdings_using_lxml(tables, ns, filing.cik, accession_no)

        processed_holdings = []
        for h in holdings_list:
            processed_holdings.append(
                {
                    "shares": h[2],
                    "value_usd": h[3],
                    "class": h[4],
                    "share_type": h[5],
                    "discretion": h[6],
                    "put_call": h[7],
                    "vote_sole": h[8],
                    "vote_shared": h[9],
                    "vote_none": h[10],
                    "ticker": h[11] or "N/A",
                    "cusip": h[12] or "N/A",
                }
            )

        return JSONResponse(
            content={
                "company": filing.company,
                "cik": filing.cik,
                "filing_date": str(filing.filing_date),
                "recent_filings": recent_list,
                "company_details": company_details,
                "sec_index_url": sec_index_url,  # <--- Return index URL
                "sec_xml_url": sec_xml_url,  # <--- Return XML URL
                "holdings": processed_holdings,
            }
        )
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/")
def read_root():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    index_path = os.path.join(base_dir, "public", "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return JSONResponse(status_code=404, content={"error": "Frontend not found"})
