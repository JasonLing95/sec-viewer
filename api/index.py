import pandas as pd
import numpy as np
import os
import re
import urllib.request

os.environ["EDGAR_LOCAL_DATA_DIR"] = "/tmp"

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from edgar import (
    set_identity,
    get_by_accession_number,
    Company,
)
from edgar.company_reports import TenK, TenQ
from edgar.ttm import detect_splits
from lxml import etree

from groq import Groq
from pydantic import BaseModel
from typing import List, Optional
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

app = FastAPI()
if not os.getenv("VERCEL"):
    app.mount("/public", StaticFiles(directory="public"), name="public")

supabase = create_client(
    os.getenv("SUPABASE_URL"),  # https://PROJECT-ID.supabase.co
    os.getenv("SUPABASE_KEY"),  # API KEY (ANON)
)

cusip_to_ticker = {}
pq_path = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ct.pq"
)
cik_mapping_df = None
cik_pq_path = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cik-lookup.pq"
)
ct_path = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "company_tickers.parquet",
)

try:
    # Load the CUSIP-to-Ticker mapping (ONLY for 13F parsing)
    if os.path.exists(pq_path):
        holdings_df = pd.read_parquet(pq_path)
        # Assuming the parquet has 'cusip' and 'ticker' columns
        if "cusip" in holdings_df.columns and "ticker" in holdings_df.columns:
            cusip_to_ticker = (
                holdings_df.set_index("cusip")["ticker"].dropna().to_dict()
            )
            print(f"Loaded {len(cusip_to_ticker)} CUSIP mappings.")

    # Load the Master Company Index (ONLY for Search)
    if os.path.exists(cik_pq_path):
        cik_mapping_df = pd.read_parquet(cik_pq_path)

        # Find the exact name of the CIK column
        master_cik_col = "CIK" if "CIK" in cik_mapping_df.columns else "cik"

        # Normalize the Master CIK column to match perfectly
        cik_mapping_df["clean_cik"] = (
            cik_mapping_df[master_cik_col]
            .astype(str)
            .str.split(".")
            .str[0]
            .str.zfill(10)
        )

        # 3. Load Ticker Mapping (company_tickers.parquet) and MERGE
        if os.path.exists(ct_path):
            ticker_df = pd.read_parquet(ct_path)
            if "cik" in ticker_df.columns:
                # Normalize the Ticker CIK column
                ticker_df["clean_cik"] = (
                    ticker_df["cik"].astype(str).str.split(".").str[0].str.zfill(10)
                )

                # Deduplicate the tickers to prevent rows from multiplying
                unique_tickers = ticker_df.drop_duplicates(subset=["clean_cik"])

                # Bring over 'ticker' and 'exchange' (avoid duplicate name columns)
                merge_cols = ["clean_cik", "ticker"]
                if "exchange" in unique_tickers.columns:
                    merge_cols.append("exchange")

                # Perform the Left Join
                cik_mapping_df = pd.merge(
                    cik_mapping_df,
                    unique_tickers[merge_cols],
                    on="clean_cik",
                    how="left",
                )

        print(
            f"Loaded Master Index: {len(cik_mapping_df)} companies (Tickers Merged!)."
        )
    else:
        cik_mapping_df = None
except Exception as e:
    print(f"Error loading Parquet files: {e}")

groq_client = Groq()


class SummaryRequest(BaseModel):
    company_name: str
    holdings: List[dict]
    user_prompt: Optional[str] = (
        "Provide a high-level summary of this portfolio's top holdings, major directional bets, and options positioning."
    )


class HoldTimeRequest(BaseModel):
    cik: str
    accession_no: str
    top_cusips: List[str]


class StatementSummaryRequest(BaseModel):
    company_name: str
    form_type: str
    statement_name: str
    table_data: list


class NarrativeSummaryRequest(BaseModel):
    company_name: str
    form_type: str
    section_title: str
    text_payload: str


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


@app.post("/api/summarize-statement")
def summarize_statement(data: StatementSummaryRequest):
    try:
        system_instructions = (
            f"You are an expert financial analyst examining the {data.statement_name} from a {data.form_type} SEC filing for {data.company_name}.\n"
            "Analyze the numerical data provided. Highlight the biggest line items, major changes, margin health, or liquidity concerns. "
            "Use clean, dense bullet points and bold key terms. Be highly specific with numbers. Do not hallucinate data not in the table."
        )

        completion = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": system_instructions},
                {
                    "role": "user",
                    "content": f"Here is the raw {data.statement_name} data:\n{str(data.table_data)}",
                },
            ],
            model="llama-3.3-70b-versatile",
            temperature=0.1,  # Extremely low temperature for strict numerical accuracy
        )
        return JSONResponse(content={"summary": completion.choices[0].message.content})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/api/summarize-narrative")
def summarize_narrative(data: NarrativeSummaryRequest):
    try:
        # Cap text at 20,000 chars to protect the context window
        safe_text = data.text_payload[:20000]

        system_instructions = (
            f"You are an expert financial analyst examining the '{data.section_title}' section of a {data.form_type} SEC filing for {data.company_name}.\n"
            "Extract the core insights, management's forward-looking outlook, and any major operational or risk factors mentioned. "
            "Use clean, dense bullet points and bold key terms."
        )

        completion = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": system_instructions},
                {
                    "role": "user",
                    "content": f"Here is the '{data.section_title}' text:\n\n{safe_text}",
                },
            ],
            model="llama-3.3-70b-versatile",
            temperature=0.3,
        )
        return JSONResponse(content={"summary": completion.choices[0].message.content})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/api/metrics/holdtime")
def calculate_holdtime(data: HoldTimeRequest):
    set_identity("data-pipeline@yourdomain.com")
    try:
        comp = Company(data.cik)
        recent_filings = comp.get_filings(form="13F-HR").latest(12)

        # Identify where the current filing is in the history
        start_idx = 0
        for i, f in enumerate(recent_filings):
            if f.accession_no == data.accession_no:
                start_idx = i + 1  # We only want quarters BEFORE the current one
                break

        history_to_check = recent_filings[start_idx : start_idx + 11]

        historical_cusip_sets = []
        ns = {"ns": "http://www.sec.gov/edgar/document/thirteenf/informationtable"}

        for f in history_to_check:
            try:
                xml_text = None
                for att in f.attachments:
                    if (
                        "infotable" in att.document.lower()
                        or "INFORMATION TABLE" in att.document_type.upper()
                    ):
                        xml_text = att.text()
                        break

                if xml_text:
                    root = etree.fromstring(xml_text.encode("utf-8"))
                    # HIGH SPEED OPTIMIZATION: Only parse the CUSIP strings, ignore the rest of the XML
                    cusips = set(
                        [
                            node.text.strip()
                            for node in root.xpath(
                                "//ns:infoTable/ns:cusip", namespaces=ns
                            )
                            if node.text
                        ]
                    )
                    historical_cusip_sets.append(cusips)
                else:
                    historical_cusip_sets.append(set())
            except:
                historical_cusip_sets.append(set())  # Failsafe for corrupted SEC files

        # Calculate streak for the requested Top 10 CUSIPs
        total_quarters = 0
        for cusip in data.top_cusips:
            streak = 1  # Starts at 1 for the current quarter
            for past_set in historical_cusip_sets:
                if cusip in past_set:
                    streak += 1
                else:
                    break  # Streak broken
            total_quarters += streak

        avg_hold = round(total_quarters / max(len(data.top_cusips), 1), 1)

        return JSONResponse(content={"avg_top_10_hold": avg_hold})

    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


def get_sgml_acceptance_time(cik, accession_no):
    """Fetches the first 1000 bytes of the SEC SGML .txt file to extract the ACCEPTANCE-DATETIME."""
    cik_stripped = str(cik).lstrip("0")
    acc_no_stripped = accession_no.replace("-", "")
    txt_url = f"https://www.sec.gov/Archives/edgar/data/{cik_stripped}/{acc_no_stripped}/{accession_no}.txt"

    try:
        # Pass the mandatory SEC User-Agent
        req = urllib.request.Request(
            txt_url, headers={"User-Agent": "data-pipeline@yourdomain.com"}
        )

        # Only read the first 1000 bytes to keep this lightning fast
        with urllib.request.urlopen(req) as response:
            header_text = response.read(1000).decode("utf-8")

        # Regex to find <ACCEPTANCE-DATETIME>20241101060136
        match = re.search(r"<ACCEPTANCE-DATETIME>(\d{14})", header_text)
        if match:
            raw_dt = match.group(1)
            # Format it clearly: YYYY-MM-DD HH:MM:SS
            return f"{raw_dt[:4]}-{raw_dt[4:6]}-{raw_dt[6:8]} {raw_dt[8:10]}:{raw_dt[10:12]}:{raw_dt[12:14]}"
    except Exception as e:
        print(f"Failed to parse SGML header for {accession_no}: {e}")

    return "N/A"


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


@app.get("/api/search")
def search_database(q: str):
    try:
        if not q or len(q) < 2 or cik_mapping_df is None:
            return JSONResponse(content={"results": []})

        q_lower = q.lower()

        # Detect column names safely
        cols = {str(c).lower(): c for c in cik_mapping_df.columns}
        col_cik = cols.get("cik") or cols.get("clean_cik")
        col_name = cols.get("company name") or cols.get("title") or cols.get("name")
        col_ticker = cols.get("ticker")

        # Filter by CIK (if numeric) or Name/Ticker
        mask = pd.Series(False, index=cik_mapping_df.index)

        if q.isdigit() and col_cik:
            # NUMERIC SEARCH: Search CIKs
            mask = (
                cik_mapping_df[col_cik]
                .astype(str)
                .str.lstrip("0")
                .str.contains(q.lstrip("0"), na=False)
            )
            matches = cik_mapping_df[mask].head(10)
        else:
            # TEXT SEARCH: Prioritize Exact Tickers over Fuzzy Names
            exact_ticker_mask = pd.Series(False, index=cik_mapping_df.index)
            fuzzy_mask = pd.Series(False, index=cik_mapping_df.index)

            # 1. Look for Exact Ticker Matches (Highest Priority)
            if col_ticker:
                exact_ticker_mask = (
                    cik_mapping_df[col_ticker].astype(str).str.lower() == q_lower
                )

            # 2. Look for Fuzzy Name & Partial Ticker Matches
            if col_name:
                fuzzy_mask |= (
                    cik_mapping_df[col_name]
                    .astype(str)
                    .str.lower()
                    .str.contains(q_lower, na=False)
                )
            if col_ticker:
                fuzzy_mask |= (
                    cik_mapping_df[col_ticker]
                    .astype(str)
                    .str.lower()
                    .str.contains(q_lower, na=False)
                )

            # 3. Remove exact matches from the fuzzy list to prevent duplicates
            fuzzy_mask = fuzzy_mask & ~exact_ticker_mask

            # 4. Stack the results: Exact Tickers FIRST, then Fuzzy Matches
            exact_matches = cik_mapping_df[exact_ticker_mask]
            fuzzy_matches = cik_mapping_df[fuzzy_mask]

            matches = pd.concat([exact_matches, fuzzy_matches]).head(10)

        results = []
        for _, row in matches.iterrows():
            # Safely extract and format values
            raw_name = str(row.get(col_name, "Unknown")) if col_name else "Unknown"
            raw_ticker = str(row.get(col_ticker, "")) if col_ticker else ""

            raw_cik = str(row.get(col_cik, "")) if col_cik else ""
            clean_cik = (
                raw_cik.split(".")[0].zfill(10)
                if raw_cik and raw_cik != "nan"
                else "N/A"
            )

            results.append(
                {
                    "name": raw_name,
                    "cik": clean_cik,
                    "ticker": raw_ticker if raw_ticker != "nan" else "",
                }
            )

        return JSONResponse(content={"results": results})
    except Exception as e:
        print(f"SEARCH ERROR: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/company/{cik}/overview")
def get_company_overview(cik: str):
    """Fetches broad company metadata and a mixed list of all recent filings."""
    set_identity("data-pipeline@yourdomain.com")
    try:
        comp = Company(cik)

        # 1. Extract Company Details
        company_details = {
            "name": comp.name,
            "cik": str(cik),
            "fiscal_year": getattr(comp, "fiscal_year_end", "N/A"),
            "incorporated": getattr(comp, "state_of_incorporation", "N/A"),
            "category": getattr(comp, "business_category", "N/A"),
            "phone": "N/A",
            "address": "N/A",
        }

        if hasattr(comp, "data") and comp.data:
            company_details["phone"] = getattr(comp.data, "phone", "N/A")
            biz_address = getattr(comp.data, "business_address", None)
            if biz_address:
                address_parts = [
                    getattr(biz_address, "street1", ""),
                    getattr(biz_address, "city", ""),
                    getattr(biz_address, "state_or_country", ""),
                    getattr(biz_address, "zipcode", ""),
                ]
                company_details["address"] = ", ".join(filter(None, address_parts))

        # 2. Fetch All Recent Filings (Mixed Forms)
        recent_filings = []
        filings_obj = comp.get_filings()

        if filings_obj is not None:
            latest_res = filings_obj.latest(100)  # Grab the last 100 filings
            if latest_res is not None:
                if latest_res is not None:
                    if hasattr(latest_res, "__iter__"):
                        f_list = list(latest_res)
                    else:
                        f_list = [latest_res]

                for f in f_list:
                    recent_filings.append(
                        {
                            "form": f.form,
                            "date": str(f.filing_date),
                            "accession_no": str(f.accession_no),
                            "report_period": (
                                str(f.period_of_report) if f.period_of_report else "N/A"
                            ),
                        }
                    )

        return JSONResponse(
            content={"details": company_details, "filings": recent_filings}
        )

    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/filings/company/{cik}")
def get_company_filings(cik: str):
    """Fetches the 13F-HR history for a specific searched company."""
    set_identity("data-pipeline@yourdomain.com")
    try:
        comp = Company(cik)
        filings_obj = comp.get_filings(form="13F-HR")

        recent_filings = []
        if filings_obj is not None:
            # Safely get the latest 50, handling if the SEC returns None for empty results
            latest_res = filings_obj.latest(50)

            if latest_res is not None:
                if hasattr(latest_res, "__iter__"):
                    recent_filings = list(latest_res)
                else:
                    recent_filings = [latest_res]

        results = []
        for filing in recent_filings:
            results.append(
                {
                    "company": filing.company,
                    "cik": filing.cik,
                    "date": str(filing.filing_date),
                    "accession_no": filing.accession_no,
                    "report_period": (
                        str(filing.period_of_report)
                        if filing.period_of_report
                        else "N/A"
                    ),
                }
            )

        return JSONResponse(content={"filings": results, "company_name": comp.name})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/filings")
def get_recent_filings(page: int = 1):
    try:
        limit = 50
        start = (page - 1) * limit
        end = start + limit - 1

        response = (
            supabase.table("sec_filings")
            .select("*")
            .eq("form", "13F-HR")
            .order("filing_date", desc=True)
            .range(start, end)
            .execute()
        )

        results = []
        for row in response.data:
            results.append(
                {
                    "company": row.get("company_name", "N/A"),
                    "cik": str(row.get("cik", "")),
                    "date": str(row.get("filing_date", "")),
                    "accession_no": row.get("accession_no", ""),
                    "report_period": str(row.get("report_period", "N/A")),
                }
            )

        return JSONResponse(content={"filings": results, "page": page})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/filings/corporate")
def get_recent_corporate_filings(page: int = 1):
    """Fetches the latest global 10-K and 10-Q filings from Supabase."""
    try:
        limit = 50
        start = (page - 1) * limit
        end = start + limit - 1

        response = (
            supabase.table("sec_filings")
            .select("*")
            .in_("form", ["10-K", "10-Q"])
            .order("filing_date", desc=True)
            .range(start, end)
            .execute()
        )

        results = []
        for row in response.data:
            results.append(
                {
                    "company": row.get("company_name", "N/A"),
                    "cik": str(row.get("cik", "")),
                    "form": row.get("form", "N/A"),
                    "date": str(row.get("filing_date", "")),
                    "accession_no": row.get("accession_no", ""),
                    "report_period": str(row.get("report_period", "N/A")),
                }
            )

        return JSONResponse(content={"filings": results, "page": page})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/filings/company/{cik}/corporate")
def get_company_corporate_filings(cik: str):
    """Fetches the 10-Q and 10-K history for a specific searched company."""
    set_identity("data-pipeline21052026@company.com")
    try:
        comp = Company(cik)
        # Fetch everything for the company, then strictly filter
        filings_obj = comp.get_filings()

        results = []
        if filings_obj is not None:
            latest_res = filings_obj.latest(100)
            if latest_res is not None:
                if hasattr(latest_res, "__iter__"):
                    recent_filings = list(latest_res)
                else:
                    recent_filings = [latest_res]

                # Strict python filter
                corp_only = [f for f in recent_filings if f.form in ["10-K", "10-Q"]]

                for filing in corp_only:
                    results.append(
                        {
                            "company": filing.company,
                            "cik": filing.cik,
                            "form": filing.form,
                            "date": str(filing.filing_date),
                            "accession_no": filing.accession_no,
                            "report_period": (
                                str(filing.period_of_report)
                                if filing.period_of_report
                                else "N/A"
                            ),
                        }
                    )

        return JSONResponse(content={"filings": results, "company_name": comp.name})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/filings/insider")
def get_recent_insider_filings(page: int = 1):
    """Fetches global Form 4s from Supabase."""
    try:
        limit = 50
        start = (page - 1) * limit
        end = start + limit - 1

        response = (
            supabase.table("sec_filings")
            .select("*")
            .eq("form", "4")
            .order("filing_date", desc=True)
            .range(start, end)
            .execute()
        )

        results = []
        for row in response.data:
            results.append(
                {
                    "company": row.get("company_name", "N/A"),
                    "cik": str(row.get("cik", "")),
                    "form": row.get("form", "4"),
                    "date": str(row.get("filing_date", "")),
                    "accession_no": row.get("accession_no", ""),
                    "report_period": str(row.get("report_period", "N/A")),
                }
            )

        return JSONResponse(content={"filings": results, "page": page})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/filings/company/{cik}/insider")
def get_company_insider_filings(cik: str):
    """Fetches the Form 4 history for a specific searched company."""
    set_identity("data-pipeline@yourdomain.com")
    try:
        comp = Company(cik)
        filings_obj = comp.get_filings(form="4")

        results = []
        if filings_obj is not None:
            latest_res = filings_obj.latest(100)
            if latest_res is not None:
                if hasattr(latest_res, "__iter__"):
                    recent_filings = list(latest_res)
                else:
                    recent_filings = [latest_res]

                for filing in recent_filings:
                    results.append(
                        {
                            "company": filing.company,
                            "cik": str(filing.cik),
                            "form": filing.form,
                            "date": str(filing.filing_date),
                            "accession_no": str(filing.accession_no),
                            "report_period": (
                                str(filing.period_of_report)
                                if filing.period_of_report
                                else "N/A"
                            ),
                        }
                    )

        return JSONResponse(content={"filings": results, "company_name": comp.name})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/narrative/{accession_no}")
def get_narrative_sections(accession_no: str):
    set_identity("data-pipeline@yourdomain.com")
    try:
        filing = get_by_accession_number(accession_no)
        if not filing:
            return JSONResponse(status_code=404, content={"error": "Filing not found."})

        # Initialize the appropriate report object
        if filing.form in ["10-K", "10-K/A"]:
            report = TenK(filing)
        elif filing.form in ["10-Q", "10-Q/A"]:
            report = TenQ(filing)
        else:
            return JSONResponse(
                status_code=400,
                content={"error": "Unsupported form type for narrative extraction."},
            )

        sections = {}

        # DYNAMIC EXTRACTION: Loop through every available item in the filing
        if hasattr(report, "items"):
            for item_str in report.items:
                try:
                    # item_str looks like 'Part I, Item 1'
                    if "," in item_str:
                        # Split by comma to get 'Part I' and ' Item 1' (preserving the leading space)
                        part, item = item_str.split(",", 1)
                        text = report.get_item_with_part(part, item)
                    else:
                        # Fallback for unexpected formats
                        text = report[item_str]

                    # Clean up: Only add sections that actually contain meaningful text
                    if text and len(str(text).strip()) > 50:
                        # Use the native item_str (e.g., "Part I, Item 1") as the UI title
                        sections[item_str] = str(text)
                except Exception as e:
                    print(f"Could not extract {item_str}: {e}")

        if not sections:
            return JSONResponse(
                status_code=404, content={"error": "No narrative sections found."}
            )

        return JSONResponse(content={"sections": sections})

    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/financials/{accession_no}")
def get_financial_statements(accession_no: str):
    set_identity("data-pipeline@yourdomain.com")
    try:
        filing = get_by_accession_number(accession_no)
        if not filing:
            return JSONResponse(status_code=404, content={"error": "Filing not found."})

        xbrl = filing.xbrl()
        if not xbrl:
            return JSONResponse(
                status_code=404,
                content={"error": "No XBRL data found for this filing."},
            )

        statements = xbrl.statements

        def get_clean_df(stmt):
            if stmt is None:
                return None
            try:
                return stmt.to_dataframe().reset_index()
            except:
                return None

        inc_df = get_clean_df(statements.income_statement(view="detailed"))
        bal_df = get_clean_df(statements.balance_sheet(view="detailed"))
        cash_df = get_clean_df(statements.cashflow_statement(view="detailed"))

        # 2. Extract KPIs safely using Pandas
        kpis = {
            "revenue": "N/A",
            "revenue_growth": "N/A",
            "net_income": "N/A",
            "ni_growth": "N/A",
            "profit_margin": "N/A",
        }

        if inc_df is not None and not inc_df.empty:
            try:
                # Find all columns that look like dates (e.g., '2026-03-31 (Q2)')
                date_cols = [
                    c for c in inc_df.columns if re.match(r"^\d{4}-\d{2}-\d{2}", str(c))
                ]

                if len(date_cols) > 0:
                    # Pick the very first date column as the "latest" period
                    latest = date_cols[0]

                    # Extract the suffix (e.g., " (Q2)") so we compare Apples to Apples!
                    parts = str(latest).split(" ", 1)
                    suffix = f" {parts[1]}" if len(parts) > 1 else ""

                    # Find the prior year column that matches the EXACT SAME suffix
                    prior = next(
                        (col for col in date_cols[1:] if col.endswith(suffix)), None
                    )

                    # Use the ultra-clean 'standard_concept' column if it exists
                    has_std = "standard_concept" in inc_df.columns
                    if has_std:
                        rev_mask = inc_df["standard_concept"].str.contains(
                            "(?i)^revenue$", na=False
                        )
                        ni_mask = inc_df["standard_concept"].str.contains(
                            "(?i)^netincome$", na=False
                        )
                    else:
                        rev_mask = inc_df["label"].str.contains(
                            "(?i)total revenue|net revenues|net sales|revenue", na=False
                        )
                        ni_mask = inc_df["label"].str.contains(
                            "(?i)net income|net earnings", na=False
                        )

                    rev_latest = None
                    ni_latest = None

                    # Calculate Revenue & Growth
                    if rev_mask.any():
                        rev_row = inc_df[rev_mask].iloc[0]
                        v_latest = rev_row.get(latest)
                        if pd.notna(v_latest) and str(v_latest).strip() != "":
                            rev_latest = float(v_latest)
                            kpis["revenue"] = f"${rev_latest:,.0f}"

                            if (
                                prior
                                and pd.notna(rev_row.get(prior))
                                and str(rev_row.get(prior)).strip() != ""
                            ):
                                v_prior = float(rev_row.get(prior))
                                if v_prior != 0:
                                    kpis["revenue_growth"] = (
                                        f"{((rev_latest - v_prior) / abs(v_prior)) * 100:+.1f}%"
                                    )

                    # Calculate Net Income & Growth
                    if ni_mask.any():
                        ni_row = inc_df[ni_mask].iloc[0]
                        v_latest = ni_row.get(latest)
                        if pd.notna(v_latest) and str(v_latest).strip() != "":
                            ni_latest = float(v_latest)
                            kpis["net_income"] = f"${ni_latest:,.0f}"

                            if (
                                prior
                                and pd.notna(ni_row.get(prior))
                                and str(ni_row.get(prior)).strip() != ""
                            ):
                                v_prior = float(ni_row.get(prior))
                                if v_prior != 0:
                                    kpis["ni_growth"] = (
                                        f"{((ni_latest - v_prior) / abs(v_prior)) * 100:+.1f}%"
                                    )

                    # Calculate Profit Margin
                    if rev_latest and ni_latest and rev_latest != 0:
                        kpis["profit_margin"] = f"{(ni_latest / rev_latest) * 100:.1f}%"
            except Exception as e:
                print(f"KPI Extraction Failed: {e}")

        def extract_statement(stmt):
            try:
                # Check if the statement object actually exists
                if stmt is not None:
                    df = stmt.to_dataframe()

                    # Prevent row labels (like "Net Income") from being stripped during JSON conversion
                    df = df.reset_index()

                    df = df.replace([np.inf, -np.inf], "")
                    df = df.fillna("")
                    return df.to_dict(orient="records")
            except Exception as e:
                print(f"Statement extraction failed: {e}")
            return []

        # Pass the property object directly, NO parenthesis!
        income_data = extract_statement(statements.income_statement())
        balance_data = extract_statement(statements.balance_sheet())
        cashflow_data = extract_statement(statements.cashflow_statement())

        return JSONResponse(
            content={
                "kpis": kpis,
                "income_statement": income_data,
                "balance_sheet": balance_data,
                "cash_flow": cashflow_data,
            }
        )

    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/raw/{accession_no}")
def get_raw_sec_document(accession_no: str):
    """Proxies the SEC HTML to bypass X-Frame-Options blocking."""
    set_identity("data-pipeline@yourdomain.com")
    try:
        filing = get_by_accession_number(accession_no)
        if not filing:
            return HTMLResponse(content="<h1>Filing not found.</h1>", status_code=404)

        html_content = filing.html()

        # Inject a base URL so the SEC's relative images and CSS links still load perfectly
        if html_content and "<head>" in html_content:
            html_content = html_content.replace(
                "<head>", "<head><base href='https://www.sec.gov/'>"
            )

        return HTMLResponse(content=html_content or "<h1>No HTML content found.</h1>")
    except Exception as e:
        return HTMLResponse(
            content=f"<h1>Error loading document: {str(e)}</h1>", status_code=500
        )


@app.get("/api/filings/formd")
def get_recent_formd_filings(page: int = 1):
    """Fetches global Form D and D/A filings from Supabase."""
    try:
        limit = 50
        start = (page - 1) * limit
        end = start + limit - 1

        response = (
            supabase.table("sec_filings")
            .select("*")
            .in_("form", ["D", "D/A"])
            .order("filing_date", desc=True)
            .range(start, end)
            .execute()
        )

        results = []
        for row in response.data:
            results.append(
                {
                    "company": row.get("company_name", "N/A"),
                    "cik": str(row.get("cik", "")),
                    "form": row.get("form", "D"),
                    "date": str(row.get("filing_date", "")),
                    "accession_no": row.get("accession_no", ""),
                    "report_period": str(row.get("report_period", "N/A")),
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

        comp = None
        previous_filing = None
        try:
            comp = Company(filing.cik)
            company_details["fiscal_year"] = getattr(comp, "fiscal_year_end", "N/A")
            company_details["incorporated"] = getattr(
                comp, "state_of_incorporation", "N/A"
            )
            company_details["category"] = getattr(comp, "business_category", "N/A")

            if hasattr(comp, "data") and comp.data:
                company_details["phone"] = getattr(comp.data, "phone", "N/A")
                biz_address = getattr(comp.data, "business_address", None)
            else:
                company_details["phone"] = "N/A"
                biz_address = None

            if biz_address:
                address_parts = [
                    getattr(biz_address, "street1", ""),
                    getattr(biz_address, "city", ""),
                    getattr(biz_address, "state_or_country", ""),
                    getattr(biz_address, "zipcode", ""),
                ]
                company_details["address"] = ", ".join(filter(None, address_parts))

            # Fetch the history to find the previous quarter
            recent_filings = comp.get_filings(form="13F-HR").latest(12)
            for i, rf in enumerate(recent_filings):
                recent_list.append(
                    {"accession_no": rf.accession_no, "date": str(rf.filing_date)}
                )
                # Find the filing that immediately precedes the currently requested one
                if rf.accession_no == accession_no and i + 1 < len(recent_filings):
                    previous_filing = recent_filings[i + 1]
        except Exception as e:
            print(f"Metadata extraction failed: {e}")

        cik_stripped = str(filing.cik).lstrip("0")
        acc_no_stripped = accession_no.replace("-", "")
        sec_index_url = f"https://www.sec.gov/Archives/edgar/data/{cik_stripped}/{acc_no_stripped}/{accession_no}-index.html"

        # 2. Helper function to parse XML attachments
        def parse_filing_xml(f_obj):
            xml_text = None
            xml_url = "#"
            for att in f_obj.attachments:
                if (
                    "infotable" in att.document.lower()
                    or "INFORMATION TABLE" in att.document_type.upper()
                ):
                    xml_text = att.text()
                    c_strip = str(f_obj.cik).lstrip("0")
                    a_strip = f_obj.accession_no.replace("-", "")
                    xml_url = getattr(
                        att,
                        "url",
                        f"https://www.sec.gov/Archives/edgar/data/{c_strip}/{a_strip}/{att.document}",
                    )
                    break
            if not xml_text:
                return [], xml_url
            root = etree.fromstring(xml_text.encode("utf-8"))
            ns = {"ns": "http://www.sec.gov/edgar/document/thirteenf/informationtable"}
            tables = root.xpath("//ns:infoTable", namespaces=ns)
            return (
                gather_holdings_using_lxml(tables, ns, f_obj.cik, f_obj.accession_no),
                xml_url,
            )

        # 3. Parse Current Quarter
        current_holdings, sec_xml_url = parse_filing_xml(filing)
        if not current_holdings:
            return JSONResponse(
                status_code=404, content={"error": "Information table XML not found."}
            )

        # 4. Parse Previous Quarter (if it exists)
        previous_holdings = []
        if previous_filing:
            previous_holdings, _ = parse_filing_xml(previous_filing)

        # 5. Build lookup dictionary for previous holdings
        prev_dict = {}
        for h in previous_holdings:
            key = f"{h[12]}_{h[7]}"  # CUSIP + Put/Call flag
            if key not in prev_dict:
                # Store the SEC issuer name for historical reference
                prev_dict[key] = {"shares": 0, "value_usd": 0, "issuer": h[11] or "N/A"}
            prev_dict[key]["shares"] += h[2]
            prev_dict[key]["value_usd"] += h[3]

        # 6. Map current holdings and calculate changes
        processed_holdings = []
        current_keys = set()

        for h in current_holdings:
            cusip = h[12] or "N/A"
            put_call = h[7]
            key = f"{cusip}_{put_call}"
            current_keys.add(key)

            current_shares = h[2]
            current_value = h[3]

            prev_data = prev_dict.get(key, {"shares": 0, "value_usd": 0})
            prev_shares = prev_data["shares"]
            prev_value = prev_data["value_usd"]

            status = "Maintained"
            change_shares = 0
            change_pct = 0.0

            if prev_shares == 0:
                status = "New"
                change_shares = current_shares
            elif current_shares > prev_shares:
                status = "Increased"
                change_shares = current_shares - prev_shares
                change_pct = (change_shares / prev_shares) * 100
            elif current_shares < prev_shares:
                status = "Decreased"
                change_shares = current_shares - prev_shares
                change_pct = (change_shares / prev_shares) * 100

            # Separate the SEC Name and the Mapped Ticker
            sec_name = h[11] or "N/A"
            mapped_ticker = cusip_to_ticker.get(
                cusip, "-"
            )  # Show "-" if no ticker is found

            processed_holdings.append(
                {
                    "ticker": mapped_ticker,
                    "issuer": sec_name,  # <--- NEW SEPARATE FIELD
                    "cusip": cusip,
                    "class": h[4],
                    "share_type": h[5],
                    "discretion": h[6],
                    "put_call": put_call,
                    "vote_sole": h[8],
                    "vote_shared": h[9],
                    "vote_none": h[10],
                    "shares": current_shares,
                    "value_usd": current_value,
                    "prev_shares": prev_shares,
                    "prev_value_usd": prev_value,
                    "change_shares": change_shares,
                    "change_pct": round(change_pct, 2),
                    "status": status,
                }
            )

        # 7. Find Closed Positions
        for key, prev_data in prev_dict.items():
            if key not in current_keys:
                cusip, put_call = key.split("_")

                mapped_ticker = cusip_to_ticker.get(cusip, "-")

                processed_holdings.append(
                    {
                        "ticker": mapped_ticker,
                        "issuer": prev_data["issuer"],  # <--- NEW SEPARATE FIELD
                        "cusip": cusip,
                        "class": "N/A",
                        "share_type": "N/A",
                        "discretion": "N/A",
                        "put_call": put_call,
                        "vote_sole": 0,
                        "vote_shared": 0,
                        "vote_none": 0,
                        "shares": 0,
                        "value_usd": 0,
                        "prev_shares": prev_data["shares"],
                        "prev_value_usd": prev_data["value_usd"],
                        "change_shares": -prev_data["shares"],
                        "change_pct": -100.0,
                        "status": "Closed",
                    }
                )

        accepted_time = get_sgml_acceptance_time(filing.cik, filing.accession_no)

        return JSONResponse(
            content={
                "company": filing.company,
                "cik": filing.cik,
                "filing_date": str(filing.filing_date),
                "report_period": (
                    str(filing.period_of_report) if filing.period_of_report else "N/A"
                ),
                "accepted_time": accepted_time,
                "recent_filings": recent_list,
                "company_details": company_details,
                "sec_index_url": sec_index_url,
                "sec_xml_url": sec_xml_url,
                "holdings": processed_holdings,
            }
        )
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/api/trends/{accession_no}/{stmt_type}")
def get_financial_trends(accession_no: str, stmt_type: str):
    set_identity("data-pipeline@yourdomain.com")
    try:
        filing = get_by_accession_number(accession_no)
        if not filing:
            return JSONResponse(status_code=404, content={"error": "Filing not found."})

        comp = Company(filing.cik)

        # 1. Fetch the 5-Year Stitched Statements
        if stmt_type == "income":
            stmt = comp.income_statement(periods=5)
        elif stmt_type == "balance":
            stmt = comp.balance_sheet(periods=5)
        elif stmt_type == "cash":
            stmt = comp.cashflow_statement(periods=5)
        else:
            return JSONResponse(
                status_code=400, content={"error": "Invalid statement type"}
            )

        if stmt is None:
            return JSONResponse(
                status_code=404, content={"error": "Trend data not available."}
            )

        # 2. Detect Historical Stock Splits (Wrap in try/except to prevent SEC API timeout crashes)
        splits_info = []
        try:
            facts = comp.get_facts()
            if facts:
                splits = detect_splits(facts.get_all_facts())
                if splits:
                    for s in splits:
                        # Extract the ratio (e.g., 4.0 for a 4-for-1 split) and the date
                        ratio = float(s.get("ratio", 1.0))
                        split_str = (
                            f"{int(ratio)}-for-1"
                            if ratio >= 1
                            else f"1-for-{int(1/ratio)} Reverse"
                        )
                        splits_info.append(
                            {
                                "date": str(s.get("date", "Unknown")),
                                "ratio_str": split_str,
                            }
                        )
        except Exception as e:
            print(f"Split detection failed: {e}")

        # 3. Convert to Pandas safely
        df = stmt.to_dataframe().reset_index()
        df = df.replace([np.inf, -np.inf], "")
        df = df.fillna("")

        return JSONResponse(
            content={
                "trend_data": df.to_dict(orient="records"),
                "splits": splits_info,  # NEW: Send split metadata to the UI
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
