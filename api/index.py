import os

# Ensure Vercel's read-only file system doesn't crash the edgar cache
os.environ["EDGAR_LOCAL_DATA_DIR"] = "/tmp"

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from edgar import set_identity, get_filings, get_by_accession_number
from lxml import etree

app = FastAPI()


# ---------------------------------------------------------
# Your custom lxml parser
# ---------------------------------------------------------
def gather_holdings_using_lxml(tables, ns, cik, accession_number) -> list[list]:
    """Parse XML soup and return list of Holding objects"""
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
        if share_type not in ["SH", "PRN", ""]:  # Allow empty for malformed filings
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


# ---------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------
@app.get("/api/filings")
def get_recent_filings():
    set_identity("data-pipeline@yourdomain.com")
    try:
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


@app.get("/api/holdings/{accession_no}")
def get_holdings(accession_no: str):
    set_identity("data-pipeline@yourdomain.com")
    try:
        filing = get_by_accession_number(accession_no)

        # 1. Find the raw XML Information Table attachment
        xml_text = None
        for att in filing.attachments:
            if (
                "infotable" in att.document.lower()
                or "INFORMATION TABLE" in att.document_type.upper()
            ):
                xml_text = att.text()
                break

        if not xml_text:
            return JSONResponse(
                status_code=404,
                content={"error": "Information table XML not found in this filing."},
            )

        # 2. Set up the lxml etree and namespaces
        # SEC uses a specific namespace for 13F information tables
        root = etree.fromstring(xml_text.encode("utf-8"))
        ns = {"ns": "http://www.sec.gov/edgar/document/thirteenf/informationtable"}
        tables = root.xpath("//ns:infoTable", namespaces=ns)

        # 3. Run your custom parser
        holdings_list = gather_holdings_using_lxml(tables, ns, filing.cik, accession_no)

        # 4. Map your custom list structure to the frontend JSON format
        processed_holdings = []
        for h in holdings_list:
            processed_holdings.append(
                {
                    "ticker": h[11] or "N/A",  # clean_name is at index 11
                    "cusip": h[12] or "N/A",  # cusip is at index 12
                    "shares": h[2],  # shares_amount is at index 2
                    "value_usd": h[3],  # value is at index 3
                    "class": h[4],  # title_of_class is at index 4
                }
            )

        return JSONResponse(
            content={
                "company": filing.company,
                "holdings": processed_holdings[
                    :500
                ],  # Increased cap since lxml is much faster
            }
        )
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})
