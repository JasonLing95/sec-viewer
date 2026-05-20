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


class HoldTimeRequest(BaseModel):
    cik: str
    accession_no: str
    top_cusips: List[str]


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

        comp = None
        previous_filing = None
        try:
            comp = Company(filing.cik)
            company_details["fiscal_year"] = getattr(comp, "fiscal_year_end", "N/A")
            company_details["incorporated"] = getattr(
                comp, "state_of_incorporation", "N/A"
            )
            company_details["phone"] = getattr(comp, "phone", "N/A")
            company_details["category"] = getattr(comp, "business_category", "N/A")

            biz_address = getattr(comp, "business_address", None)
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
                prev_dict[key] = {"shares": 0, "value_usd": 0, "ticker": h[11] or "N/A"}
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

            processed_holdings.append(
                {
                    "ticker": h[11] or "N/A",
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
                    "prev_value_usd": prev_value,  # <--- NEW DATA
                    "change_shares": change_shares,
                    "change_pct": round(change_pct, 2),
                    "status": status,
                }
            )

        # 7. Find Closed Positions
        for key, prev_data in prev_dict.items():
            if key not in current_keys:
                cusip, put_call = key.split("_")
                processed_holdings.append(
                    {
                        "ticker": prev_data["ticker"],
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
                        "prev_value_usd": prev_data["value_usd"],  # <--- NEW DATA
                        "change_shares": -prev_data["shares"],
                        "change_pct": -100.0,
                        "status": "Closed",
                    }
                )

        return JSONResponse(
            content={
                "company": filing.company,
                "cik": filing.cik,
                "filing_date": str(filing.filing_date),
                "recent_filings": recent_list,
                "company_details": company_details,
                "sec_index_url": sec_index_url,
                "sec_xml_url": sec_xml_url,
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
