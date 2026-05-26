// --- FILINGS STATE ---
let currentFilingsPage = 1;

// --- STOCKS STATE ---
let allStocks = []; let filteredStocks = []; let currentStocksPage = 1;
let sortColStocks = 'value_usd'; let sortAscStocks = false;

// --- OPTIONS STATE ---
let allOptions = []; let filteredOptions = []; let currentOptionsPage = 1;
let sortColOptions = 'value_usd'; let sortAscOptions = false;

// --- AI CACHE STATE ---
let cachedPortfolioSummary = "";
let cachedStatementSummaries = {};
let cachedNarrativeSummaries = {};

// --- TREND STATE ---
let isTrendMode = false;
let trendCache = { income: null, balance: null, cash: null };
let splitsCache = [];

let searchTimeout = null;

// --- CORPORATE STATE ---
let currentCorporatePage = 1;
let currentModule = '13f'; // Track which module is active

let currentOverviewPage = 1;

function hideAllViews() {
    const views = [
        'filings-view', 'holdings-view', 'overview-view', 
        'corporate-view', 'corp-doc-view', 
        'insider-view', 'insider-doc-view', 
        'formd-view', 'formd-doc-view', 
        'thirteend-view', 'thirteend-doc-view'
    ];
    
    views.forEach(viewId => {
        const el = document.getElementById(viewId);
        if (el) el.style.display = 'none';
    });
}

function handleGlobalSearch(e) {
    const query = e.target.value.trim();
    const dropdown = document.getElementById('search-dropdown');
    
    // Hide dropdown if query is too short
    if (query.length < 2) {
        dropdown.style.display = 'none';
        return;
    }

    // Debounce: Wait 300ms after the user stops typing before fetching
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        dropdown.style.display = 'block';
        dropdown.innerHTML = '<div class="search-loading">Searching database...</div>';

        fetch(`/api/search?q=${encodeURIComponent(query)}`)
            .then(res => res.json())
            .then(data => {
                if (data.error || !data.results || data.results.length === 0) {
                    dropdown.innerHTML = '<div class="search-loading">No companies found.</div>';
                    return;
                }

                dropdown.innerHTML = '';
                data.results.forEach(res => {
                    // When clicked, fetch this specific company's filings
                    dropdown.innerHTML += `
                        <div class="search-item" onclick="loadCompanyOverview('${res.cik}')">
                            <span class="search-item-name">${res.name}</span>
                            <span class="search-item-cik">CIK: ${res.cik}</span>
                        </div>
                    `;
                });
            })
            .catch(err => {
                dropdown.innerHTML = '<div class="search-loading" style="color: #ff5252;">Search failed.</div>';
            });
    }, 300);
}

function loadCompanyFilings(cik, companyName) {
    hideAllViews();

    // RESET HIGHLIGHT TO THE 13F TAB SINCE WE ARE WEAVING BACK INTO A 13F LIST
    document.getElementById('nav-13f').classList.add('active');
    if (document.getElementById('nav-corp')) document.getElementById('nav-corp').classList.remove('active');
    if (document.getElementById('nav-insider')) document.getElementById('nav-insider').classList.remove('active');
    if (document.getElementById('nav-formd')) document.getElementById('nav-formd').classList.remove('active');
    if (document.getElementById('nav-13d')) document.getElementById('nav-13d').classList.remove('active');

    // Close dropdown and reset search text
    document.getElementById('search-dropdown').style.display = 'none';
    document.getElementById('global-search-input').value = "";
    
    // Turn off global live auto-refresh
    document.getElementById('auto-refresh-cb').checked = false;
    toggleLiveMode();

    // 2. Set up the local filings history view layout states directly
    document.getElementById('filings-view').style.display = 'block';
    document.getElementById('back-btn').style.display = 'none';
    document.getElementById('filings-controls').style.display = 'flex'; 
    document.getElementById('page-title').innerText = `13F-HR History: ${companyName}`;

    const tbody = document.getElementById('filings-body');
    tbody.innerHTML = `<tr><td colspan="6" class="loading">Loading SEC history for CIK ${cik}...</td></tr>`;
    
    // Disable pagination since we are viewing a single company
    document.getElementById('f-prev').disabled = true;
    document.getElementById('f-next').disabled = true;
    document.getElementById('f-ind').innerText = "All Recent";

    fetch(`/api/filings/company/${cik}`)
        .then(res => res.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            
            tbody.innerHTML = '';
            if (data.filings.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">No 13F-HR filings found for this entity.</td></tr>`;
                return;
            }
            
            data.filings.forEach((f, i) => {
                // Wired click target up natively
                tbody.innerHTML += `<tr style="cursor: pointer;" onclick="fetchHoldings('${f.accession_no}')">
                    <td>${i + 1}</td>
                    <td style="font-weight: bold; color: #111;">${f.company}</td>
                    <td class="mono">${f.cik}</td>
                    <td>${f.report_period}</td> 
                    <td>${f.date}</td>
                    <td class="mono" style="color: #0070f3; text-decoration: underline;">${f.accession_no}</td>
                </tr>`;
            });
            updateTimestamp();
        })
        .catch(err => {
            tbody.innerHTML = `<tr><td colspan="6" style="color:red; text-align:center;">Error: ${err.message}</td></tr>`;
        });
}

// Hide dropdown if user clicks anywhere else on the page
document.addEventListener('click', function(event) {
    const searchContainer = document.querySelector('.search-container');
    const dropdown = document.getElementById('search-dropdown');
    if (searchContainer && !searchContainer.contains(event.target)) {
        dropdown.style.display = 'none';
    }
});

// ==========================================
// REAL-TIME AUTO REFRESH LOGIC
// ==========================================
let liveRefreshInterval = null;

function toggleLiveMode() {
    const isChecked = document.getElementById('auto-refresh-cb').checked;
    const indicator = document.getElementById('live-indicator');
    
    if (isChecked) {
        indicator.style.backgroundColor = "#2e7d32"; // Professional Green
        liveRefreshInterval = setInterval(() => {
            if (document.getElementById('filings-view').style.display === 'block' && currentFilingsPage === 1) {
                silentFetchFilings();
            }
        }, 60000); 
    } else {
        indicator.style.backgroundColor = "#ccc"; // Inactive Gray
        clearInterval(liveRefreshInterval);
    }
}

function silentFetchFilings() {
    fetch(`/api/filings?page=1`)
        .then(res => res.json())
        .then(data => {
            if (data.error) return;
            
            const tbody = document.getElementById('filings-body');
            // Completely rebuild the table rows silently in the background
            let newHtml = '';
            data.filings.forEach((f, i) => {
                newHtml += `<tr onclick="fetchHoldings('${f.accession_no}')">
                    <td>${i + 1}</td>
                    <td style="font-weight: bold;">${f.company}</td>
                    <td class="mono">${f.cik}</td>
                    <td>${f.report_period}</td> <td>${f.date}</td>
                    <td class="mono">${f.accession_no}</td>
                </tr>`;
            });
            
            // Only update the DOM if the data is actually ready
            if (newHtml !== '') {
                tbody.innerHTML = newHtml;
                updateTimestamp(); // <--- ADD THIS HERE
            }
        })
        .catch(err => console.error("Background sync failed:", err));
}

// ==========================================
// FILINGS LOGIC
// ==========================================
function changeFilingsPage(dir) {
    if (currentFilingsPage + dir > 0) loadFilings(currentFilingsPage + dir);
}

function updateTimestamp() {
    const now = new Date();
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    document.getElementById('last-updated-text').innerText = `Updated: ${timeString}`;
}

function loadFilings(page) {
    currentFilingsPage = page;
    document.getElementById('f-ind').innerText = `Page ${page}`;
    document.getElementById('f-prev').disabled = page === 1;
    
    // --- NEW: TOGGLE DISABLE LOGIC ---
    const cb = document.getElementById('auto-refresh-cb');
    const label = document.getElementById('live-toggle-label');
    const indicator = document.getElementById('live-indicator');

    if (page === 1) {
        // Unlock the toggle on Page 1
        cb.disabled = false;
        label.style.color = "#555";
        label.style.cursor = "pointer";
    } else {
        // Lock and turn off the toggle on Page 2+
        cb.disabled = true;
        cb.checked = false; // Force uncheck
        label.style.color = "#aaa"; // Gray out text
        label.style.cursor = "not-allowed";
        indicator.style.backgroundColor = "#ccc"; // Reset dot to gray
        clearInterval(liveRefreshInterval); // Stop the background polling
    }
    // ----------------------------------

    const tbody = document.getElementById('filings-body');
    tbody.innerHTML = `<tr><td colspan="5" class="loading">Loading page ${page}...</td></tr>`;

    fetch(`/api/filings?page=${page}`)
        .then(res => res.json())
        .then(data => {
            tbody.innerHTML = '';
            document.getElementById('f-next').disabled = data.filings.length < 50;
            const offset = (page - 1) * 50;
            data.filings.forEach((f, i) => {
                tbody.innerHTML += `<tr onclick="fetchHoldings('${f.accession_no}')">
                    <td>${offset + i + 1}</td>
                    <td style="font-weight: bold;">${f.company}</td>
                    <td class="mono">${f.cik}</td>
                    <td>${f.report_period}</td> <td>${f.date}</td>
                    <td class="mono">${f.accession_no}</td>
                </tr>`;
            });
            updateTimestamp();
        }).catch(err => tbody.innerHTML = `<tr><td colspan="5" style="color:red; text-align:center;">Error: ${err.message}</td></tr>`);
}

// ==========================================
// FETCH AND SPLIT HOLDINGS
// ==========================================
function fetchHoldings(accessionNo, updateUrl = true) {
    const urlParams = new URLSearchParams(window.location.search);
    const currentMod = urlParams.get('module');
    const currentCik = urlParams.get('cik');

    hideAllViews();
    cachedPortfolioSummary = "";

    if (updateUrl) {
        const url = new URL(window.location);
        url.searchParams.set('accession', accessionNo);
        if (currentMod === 'overview' && currentCik) {
            url.searchParams.set('origin', 'overview');
            url.searchParams.set('originCik', currentCik);
        }
        window.history.pushState({ accessionNo }, '', url);
    }

    const finalUrlParams = new URLSearchParams(window.location.search);
    const origin = finalUrlParams.get('origin');
    const originCik = finalUrlParams.get('originCik');
    const backBtn = document.getElementById('back-btn');

    if (origin === 'overview' && originCik) {
        backBtn.innerText = "← Back to Company Overview";
        backBtn.onclick = () => loadCompanyOverview(originCik, currentOverviewPage);
    } else {
        backBtn.innerText = "← Back to 13F List";
        backBtn.onclick = () => switchModule(null, '13f');
    }
    backBtn.style.display = 'block';

    document.getElementById('holdings-view').style.display = 'block';
    document.getElementById('filings-controls').style.display = 'none';
    document.getElementById('page-title').innerText = "SEC 13F-HR Holdings Detail";

    document.getElementById('c-name').innerText = "Loading data...";
    document.getElementById('stocks-body').innerHTML = `<tr><td colspan="8" class="loading">Parsing filing...</td></tr>`;
    document.getElementById('options-body').innerHTML = `<tr><td colspan="8" class="loading">Parsing filing...</td></tr>`;
    document.getElementById('search-input').value = "";

    fetch(`/api/holdings/${accessionNo}`)
        .then(res => res.json())
        .then(data => {
            if(data.error) throw new Error(data.error);
            
            document.getElementById('c-name').innerText = data.company;
            document.getElementById('c-cik').innerText = data.cik;
            document.getElementById('c-period').innerText = data.report_period;
            document.getElementById('c-date').innerText = data.filing_date;
            document.getElementById('c-accepted').innerText = data.accepted_time;
            document.getElementById('c-acc').innerText = accessionNo;
            document.getElementById('c-link-index').href = data.sec_index_url;
            document.getElementById('c-link-xml').href = data.sec_xml_url;
            
            const cd = data.company_details;
            document.getElementById('c-cat').innerText = cd ? cd.category : "N/A";
            document.getElementById('c-fye').innerText = cd ? cd.fiscal_year : "N/A";
            document.getElementById('c-inc').innerText = cd ? cd.incorporated : "N/A";
            document.getElementById('c-phone').innerText = cd ? cd.phone : "N/A";
            document.getElementById('c-add').innerText = cd ? cd.address : "N/A";
            
            document.getElementById('c-recent').innerHTML = data.recent_filings.map(rf => 
                `<span class="recent-link" onclick="fetchHoldings('${rf.accession_no}')">${rf.date}</span>`
            ).join(' | ');

            // SPLIT DATA INTO STOCKS AND OPTIONS
            allStocks = data.holdings.filter(h => h.put_call === 'NONE' || !h.put_call);
            allOptions = data.holdings.filter(h => h.put_call === 'PUT' || h.put_call === 'CALL');

            // 1. Calculate Grand Totals First
            const totalPortfolioValue = data.holdings.reduce((sum, item) => sum + (item.value_usd || 0), 0);
            const prevTotalValue = data.holdings.reduce((sum, item) => sum + (item.prev_value_usd || 0), 0);
            
            const totalEquityValue = allStocks.reduce((sum, item) => sum + (item.value_usd || 0), 0);
            const totalOptionsValue = allOptions.reduce((sum, item) => sum + (item.value_usd || 0), 0);
            
            let optionsRatio = "0.0x";
            if (totalEquityValue > 0) {
                optionsRatio = (totalOptionsValue / totalEquityValue).toFixed(2) + "x";
            }
            
            const sortedByValue = [...data.holdings].sort((a, b) => b.value_usd - a.value_usd);
            const top10Value = sortedByValue.slice(0, 10).reduce((sum, item) => sum + (item.value_usd || 0), 0);
            
            let concentrationPct = totalPortfolioValue > 0 ? (top10Value / totalPortfolioValue) * 100 : 0;

            // 2. Loop through and calculate Weights, Deltas, and Turnover
            let totalBuys = 0;
            let totalSells = 0;

            data.holdings.forEach(h => {
                // Turnover calculations
                if (h.status === 'New') {
                    totalBuys += h.value_usd; 
                } else if (h.status === 'Increased') {
                    const pctAdded = h.change_shares / h.shares;
                    totalBuys += (h.value_usd * pctAdded);
                } else if (h.status === 'Closed') {
                    totalSells += h.prev_value_usd; 
                } else if (h.status === 'Decreased') {
                    const pctSold = Math.abs(h.change_shares) / h.prev_shares;
                    totalSells += (h.prev_value_usd * pctSold);
                }

                // NEW: Portfolio Weight & Weight Delta
                const currentWeight = totalPortfolioValue > 0 ? (h.value_usd / totalPortfolioValue) * 100 : 0;
                const prevWeight = prevTotalValue > 0 ? ((h.prev_value_usd || 0) / prevTotalValue) * 100 : 0;
                
                h.weight_pct = currentWeight.toFixed(2);
                h.weight_delta = (currentWeight - prevWeight).toFixed(2);
            });

            // 3. Turnover Formula: min(Buys, Sells) / Average AUM
            let turnoverPct = 0;
            let hasHistory = prevTotalValue > 0;
            if (hasHistory && totalPortfolioValue > 0) {
                const avgAUM = (prevTotalValue + totalPortfolioValue) / 2;
                turnoverPct = (Math.min(totalBuys, totalSells) / avgAUM) * 100;
            }

            // 4. Inject calculations into UI panel
            const aumMillions = (totalPortfolioValue / 1000).toFixed(2);
            document.getElementById('c-aum').innerText = `$${parseFloat(aumMillions).toLocaleString()}M`;
            document.getElementById('c-concentration').innerText = `${concentrationPct.toFixed(2)}%`;
            document.getElementById('c-options').innerText = optionsRatio;
            document.getElementById('c-turnover').innerText = hasHistory ? `${turnoverPct.toFixed(2)}%` : "N/A (No previous quarter)";
            
            // --- START ASYNC HOLD TIME CALCULATION ---
            document.getElementById('c-holdtime').innerText = "Calculating...";
            document.getElementById('c-holdtime').style.color = "#888";
            
            const top10Cusips = sortedByValue.slice(0, 10).map(h => h.cusip).filter(c => c && c !== 'N/A');
            
            fetch('/api/metrics/holdtime', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cik: data.cik.toString(),
                    accession_no: accessionNo,
                    top_cusips: top10Cusips
                })
            })
            .then(res => res.json())
            .then(metricData => {
                if(metricData.error) throw new Error(metricData.error);
                document.getElementById('c-holdtime').innerText = `${metricData.avg_top_10_hold} Qtrs`;
                document.getElementById('c-holdtime').style.color = "#111"; // Shift color to dark to indicate completion
                document.getElementById('c-holdtime').style.fontStyle = "normal";
            })
            .catch(err => {
                document.getElementById('c-holdtime').innerText = "Data Unavailable";
                console.error("Hold time calc failed:", err);
            });
            // --- END ASYNC HOLD TIME CALCULATION ---

            // Visual bar adjustment
            document.getElementById('concentration-bar-wrapper').style.display = 'block';
            document.getElementById('concentration-bar').style.width = `${concentrationPct}%`;
            
            // Color code bar based on high conviction vs diversification thresholds
            if (concentrationPct >= 60) {
                document.getElementById('concentration-bar').style.backgroundColor = '#d32f2f';
            } else if (concentrationPct >= 35) {
                document.getElementById('concentration-bar').style.backgroundColor = '#0070f3';
            } else {
                document.getElementById('concentration-bar').style.backgroundColor = '#2e7d32';
            }
            // --- END CONCENTRATION STAGE ---
            
            filteredStocks = [...allStocks];
            filteredOptions = [...allOptions];
            
            sortColStocks = 'value_usd'; sortAscStocks = false;
            sortColOptions = 'value_usd'; sortAscOptions = false;
            
            executeSortStocks();
            executeSortOptions();
        }).catch(err => {
            document.getElementById('stocks-body').innerHTML = `<tr><td colspan="8" style="color:red; text-align:center;">Error: ${err.message}</td></tr>`;
            document.getElementById('options-body').innerHTML = '';
        });
}

// ==========================================
// SHARED LOGIC (SEARCH & ROW HTML)
// ==========================================
function handleSearch(e) {
    const q = e.target.value.toLowerCase();
    const filterFn = h => 
        (h.ticker && h.ticker.toLowerCase().includes(q)) || 
        (h.issuer && h.issuer.toLowerCase().includes(q)) || // <-- ADD THIS LINE
        (h.cusip && h.cusip.toLowerCase().includes(q)) || 
        (h.class && h.class.toLowerCase().includes(q));
    
    filteredStocks = allStocks.filter(filterFn);
    filteredOptions = allOptions.filter(filterFn);
    
    currentStocksPage = 1; currentOptionsPage = 1;
    executeSortStocks(); executeSortOptions();
}

function createRowHtml(h) {
    let optBadge = `<span style="color:#aaa;">-</span>`;
    if (h.put_call === 'PUT') optBadge = `<span class="badge badge-put">PUT</span>`;
    if (h.put_call === 'CALL') optBadge = `<span class="badge badge-call">CALL</span>`;

    // Format the Shares Delta column
    let deltaHtml = `<span class="status-same">-</span>`;
    if (h.status === 'New') {
        deltaHtml = `<span class="status-new">NEW</span>`;
    } else if (h.status === 'Closed') {
        deltaHtml = `<span class="status-closed">CLOSED</span>`;
    } else if (h.status === 'Increased') {
        deltaHtml = `<span class="status-inc">▲ ${h.change_pct}%</span><br><span style="font-size:9px; color:#888;">+${h.change_shares.toLocaleString()} sh</span>`;
    } else if (h.status === 'Decreased') {
        deltaHtml = `<span class="status-dec">▼ ${Math.abs(h.change_pct)}%</span><br><span style="font-size:9px; color:#888;">${h.change_shares.toLocaleString()} sh</span>`;
    }

    // NEW: Format the Weight Delta sub-text
    let weightDeltaHtml = `<span style="color: #888; font-size: 10px;">(-)</span>`;
    if (h.status === 'New') {
        weightDeltaHtml = `<span style="color: #2e7d32; font-size: 10px;">(New)</span>`;
    } else if (h.weight_delta > 0) {
        weightDeltaHtml = `<span style="color: #2e7d32; font-size: 10px;">(+${h.weight_delta}%)</span>`;
    } else if (h.weight_delta < 0) {
        weightDeltaHtml = `<span style="color: #c62828; font-size: 10px;">(${h.weight_delta}%)</span>`;
    }

    // Dim rows that are closed out
    const rowStyle = h.status === 'Closed' ? 'opacity: 0.6; background: #fdfdfd;' : '';

    return `<tr style="${rowStyle}">
        <td class="ticker">${h.ticker}</td>
        <td style="font-weight: 500; color: #111;">${h.issuer}</td> <td class="mono">${h.cusip}</td>
        <td>${h.class}</td>
        <td style="font-weight: bold; color: #444;">
            ${h.weight_pct}%<br>${weightDeltaHtml}
        </td>
        <td><span class="badge">${h.share_type}</span></td>
        <td class="num">${h.shares.toLocaleString()}</td>
        <td class="num">$${h.value_usd.toLocaleString()}</td>
        <td class="num" style="border-left: 2px solid #eee;">${deltaHtml}</td>
        <td><span class="badge">${h.discretion}</span></td>
        <td>${optBadge}</td>
    </tr>`;
}

// ==========================================
// STOCKS TABLE LOGIC
// ==========================================
function sortStocks(col) {
    if (sortColStocks === col) sortAscStocks = !sortAscStocks;
    else { sortColStocks = col; sortAscStocks = true; }
    executeSortStocks();
}

function executeSortStocks() {
    filteredStocks.sort((a, b) => {
        let vA = a[sortColStocks]; let vB = b[sortColStocks];
        if (typeof vA === 'string') vA = vA.toLowerCase();
        if (typeof vB === 'string') vB = vB.toLowerCase();
        if (vA < vB) return sortAscStocks ? -1 : 1;
        if (vA > vB) return sortAscStocks ? 1 : -1;
        return 0;
    });
    currentStocksPage = 1;
    renderStocksTable();
}

function changeStocksPage(dir) {
    const maxPage = Math.ceil(filteredStocks.length / 50);
    if (currentStocksPage + dir > 0 && currentStocksPage + dir <= maxPage) {
        currentStocksPage += dir; renderStocksTable();
    }
}

function renderStocksTable() {
    const tbody = document.getElementById('stocks-body');
    document.getElementById('s-total').innerText = filteredStocks.length.toLocaleString();
    document.getElementById('s-ind').innerText = `Page ${currentStocksPage}`;
    
    const totalPages = Math.ceil(filteredStocks.length / 50) || 1;
    document.getElementById('s-prev').disabled = currentStocksPage === 1;
    document.getElementById('s-next').disabled = currentStocksPage === totalPages;

    tbody.innerHTML = '';
    if (filteredStocks.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;">No matching stock holdings found.</td></tr>`;
        return;
    }

    const start = (currentStocksPage - 1) * 50;
    filteredStocks.slice(start, start + 50).forEach(h => tbody.innerHTML += createRowHtml(h));
}

// ==========================================
// OPTIONS TABLE LOGIC
// ==========================================
function sortOptions(col) {
    if (sortColOptions === col) sortAscOptions = !sortAscOptions;
    else { sortColOptions = col; sortAscOptions = true; }
    executeSortOptions();
}

function executeSortOptions() {
    filteredOptions.sort((a, b) => {
        let vA = a[sortColOptions]; let vB = b[sortColOptions];
        if (typeof vA === 'string') vA = vA.toLowerCase();
        if (typeof vB === 'string') vB = vB.toLowerCase();
        if (vA < vB) return sortAscOptions ? -1 : 1;
        if (vA > vB) return sortAscOptions ? 1 : -1;
        return 0;
    });
    currentOptionsPage = 1;
    renderOptionsTable();
}

function changeOptionsPage(dir) {
    const maxPage = Math.ceil(filteredOptions.length / 50);
    if (currentOptionsPage + dir > 0 && currentOptionsPage + dir <= maxPage) {
        currentOptionsPage += dir; renderOptionsTable();
    }
}

function renderOptionsTable() {
    const tbody = document.getElementById('options-body');
    document.getElementById('o-total').innerText = filteredOptions.length.toLocaleString();
    document.getElementById('o-ind').innerText = `Page ${currentOptionsPage}`;
    
    const totalPages = Math.ceil(filteredOptions.length / 50) || 1;
    document.getElementById('o-prev').disabled = currentOptionsPage === 1;
    document.getElementById('o-next').disabled = currentOptionsPage === totalPages;

    tbody.innerHTML = '';
    if (filteredOptions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;">No matching option holdings found.</td></tr>`;
        return;
    }

    const start = (currentOptionsPage - 1) * 50;
    filteredOptions.slice(start, start + 50).forEach(h => tbody.innerHTML += createRowHtml(h));
}

function triggerAiSummary() {
    const outputBox = document.getElementById('summary-output');
    const aiBtn = document.getElementById('ai-btn');
    
    // 1. CHECK CACHE FIRST
    if (cachedPortfolioSummary) {
        outputBox.innerHTML = marked.parse(cachedPortfolioSummary);
        outputBox.style.color = "#333";
        outputBox.style.fontStyle = "normal";
        return; // Exit early without fetching!
    }

    aiBtn.disabled = true;
    aiBtn.innerText = "Analyzing Portfolio...";
    outputBox.innerText = "Llama 3.3 is parsing the filing matrix and evaluating concentration layout...";
    outputBox.style.color = "#666";
    outputBox.style.fontStyle = "italic";

    const completeDataPayload = [...allStocks, ...allOptions];
    const currentCompanyName = document.getElementById('c-name').innerText;

    fetch('/api/summarize-portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            company_name: currentCompanyName,
            holdings: completeDataPayload,
            user_prompt: "Provide a sharp, high-level summary of this portfolio's top structural holdings, major new directional bets, and options risk/leverage positioning."
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        
        // 2. SAVE TO CACHE
        cachedPortfolioSummary = data.summary;
        
        outputBox.innerHTML = marked.parse(data.summary);
        outputBox.style.color = "#333";
        outputBox.style.fontStyle = "normal";
    })
    .catch(err => {
        outputBox.innerText = `Analysis Failed: ${err.message}`;
        outputBox.style.color = "red";
        outputBox.style.fontStyle = "normal";
    })
    .finally(() => {
        aiBtn.disabled = false;
        aiBtn.innerText = "Summarize with AI";
    });
}

function switchModule(event, module, updateUrl = true) {
    if (event) event.preventDefault();
    currentModule = module;
    
    // 1. Wipe the entire canvas clean instantly!
    hideAllViews();
    
    // Save the active module to the URL so refreshes remember where you are
    if (updateUrl) {
        const url = new URL(window.location);
        url.searchParams.set('module', module);
        url.searchParams.delete('accession'); 
        
        // Clean up any Document deep-dive parameters
        url.searchParams.delete('doc');
        url.searchParams.delete('c');
        url.searchParams.delete('f');
        url.searchParams.delete('p');
        url.searchParams.delete('d');
        url.searchParams.delete('s');
        
        url.searchParams.delete('cik');
        url.searchParams.delete('page');
        window.history.pushState({ module: module }, '', url);
    }
    
    // Clear all tab active highlights safely
    document.getElementById('nav-13f').classList.remove('active');
    if (document.getElementById('nav-corp')) document.getElementById('nav-corp').classList.remove('active');
    if (document.getElementById('nav-insider')) document.getElementById('nav-insider').classList.remove('active');
    if (document.getElementById('nav-formd')) document.getElementById('nav-formd').classList.remove('active');
    if (document.getElementById('nav-13d')) document.getElementById('nav-13d').classList.remove('active');
    
    // Route to the correct master view list
    if (module === '13f') {
        document.getElementById('nav-13f').classList.add('active');
        showFilingsView(true, false, true); 
    } else if (module === 'corp') {
        document.getElementById('nav-corp').classList.add('active');
        showCorporateView(true, false, true);
    } else if (module === 'insider') {
        document.getElementById('nav-insider').classList.add('active');
        showInsiderView(true, false, true);
    } else if (module === 'formd') {
        document.getElementById('nav-formd').classList.add('active');
        showFormDView(true, false, true);
    } else if (module === '13d') {
        document.getElementById('nav-13d').classList.add('active');
        show13dView(true);
    }
}

function showFilingsView(fetchData = true, updateUrl = true, resetPage = false) {
    if (updateUrl) {
        const url = new URL(window.location);
        url.searchParams.delete('accession');
        url.searchParams.delete('doc'); // Clean up any active document params
        window.history.pushState({}, '', url);
    }
    if (resetPage) currentFilingsPage = 1;

    hideAllViews();
    
    document.getElementById('filings-view').style.display = 'block';
    document.getElementById('back-btn').style.display = 'none';
    document.getElementById('filings-controls').style.display = 'flex'; 
    document.getElementById('page-title').innerText = "Latest 13F-HR Filings";
    
    if (fetchData) loadFilings(currentFilingsPage);
}

function showCorporateView(fetchData = true, updateUrl = true, resetPage = false) {
    if (resetPage) currentCorporatePage = 1;
    
    // 1. Clear the entire workspace instantly
    hideAllViews();

    // 2. Set up local layout parameters natively
    document.getElementById('corporate-view').style.display = 'block';
    document.getElementById('back-btn').style.display = 'none';
    document.getElementById('filings-controls').style.display = 'flex'; 
    document.getElementById('page-title').innerText = "Latest 10-Q & 10-K Filings";
    
    if (fetchData) loadCorporateFilings(currentCorporatePage);
}

function showInsiderView(fetchData = true, updateUrl = true, resetPage = false) {
    if (resetPage) currentInsiderPage = 1;

    // 1. Wipe the entire canvas clean instantly
    hideAllViews();

    // 2. Open the Form 4 master list panel states explicitly
    document.getElementById('insider-view').style.display = 'block';
    document.getElementById('back-btn').style.display = 'none';
    document.getElementById('filings-controls').style.display = 'flex'; 
    document.getElementById('page-title').innerText = "Latest Form 4 Insider Trades";
    
    if (fetchData) loadInsiderFilings(currentInsiderPage);
}

function loadCorporateFilings(page) {
    currentCorporatePage = page;
    document.getElementById('c-ind').innerText = `Page ${page}`;
    document.getElementById('c-prev').disabled = page === 1;

    const tbody = document.getElementById('corporate-body');
    tbody.innerHTML = `<tr><td colspan="8" class="loading">Loading page ${page}...</td></tr>`;

    fetch(`/api/filings/corporate?page=${page}`)
        .then(res => res.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            
            tbody.innerHTML = '';
            document.getElementById('c-next').disabled = data.filings.length < 50;
            const offset = (page - 1) * 50;
            
            if (data.filings.length === 0) {
                tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;">No corporate filings found.</td></tr>`;
                return;
            }
            
            data.filings.forEach((f, i) => {
                // Color code the form badge
                const badgeColor = f.form === '10-K' ? 'background: #4a148c; color: white;' : 'background: #ff9800; color: white;';
                
                // Build URLs directly to the SEC 
                const cikStripped = String(f.cik).replace(/^0+/, '');
                const accStripped = String(f.accession_no).replace(/-/g, '');
                const secHtmlUrl = `https://www.sec.gov/Archives/edgar/data/${cikStripped}/${accStripped}/${f.accession_no}-index.html`;

                const safeCompany = f.company ? String(f.company).replace(/'/g, "&apos;").replace(/"/g, "&quot;") : "N/A";
                const reportPeriod = f.report_period || "N/A";

                tbody.innerHTML += `<tr>
                    <td>${offset + i + 1}</td>
                    <td><span class="badge" style="${badgeColor}">${f.form}</span></td>
                    <td style="font-weight: bold;">${f.company}</td>
                    <td class="mono">${f.cik}</td>
                    <td>${f.report_period}</td> 
                    <td>${f.date}</td>
                    <td class="mono">
                        <a href="javascript:void(0);" onclick="openCorporateDocument('${safeCompany}', '${f.form}', '${reportPeriod}', '${f.date}', '${f.accession_no}', '${secHtmlUrl}')" 
                           style="color: #0070f3; text-decoration: underline; font-weight: bold;" title="Read Document">
                            ${f.accession_no}
                        </a>
                    </td>
                    <td style="display: flex; gap: 8px;">
                        <button onclick="openCorporateDocument('${safeCompany}', '${f.form}', '${reportPeriod}', '${f.date}', '${f.accession_no}', '${secHtmlUrl}')" 
                                class="btn-primary" style="padding: 4px 8px; font-size: 11px;">
                            Read Document
                        </button>
                        <a href="${secHtmlUrl}" target="_blank" class="btn-primary" style="padding: 4px 8px; font-size: 11px; text-decoration: none; background: #666;">View SEC ↗</a>
                    </td>
                </tr>`;
            });
            // Re-use your existing timestamp function
            updateTimestamp();
        })
        .catch(err => {
            tbody.innerHTML = `<tr><td colspan="8" style="color:red; text-align:center;">Error: ${err.message}</td></tr>`;
        });
}

function changeCorporatePage(dir) {
    if (currentCorporatePage + dir > 0) loadCorporateFilings(currentCorporatePage + dir);
}

// ==========================================
// INSIDER FILINGS LOGIC (FORM 4)
// ==========================================
let currentInsiderPage = 1;

function loadInsiderFilings(page) {
    currentInsiderPage = page;
    document.getElementById('i-ind').innerText = `Page ${page}`;
    document.getElementById('i-prev').disabled = page === 1;

    const tbody = document.getElementById('insider-body');
    tbody.innerHTML = `<tr><td colspan="8" class="loading">Loading page ${page}...</td></tr>`;

    let fetchUrl = `/api/filings/insider?page=${page}`;
    if (page === 1) {
        fetchUrl += `&_t=${Date.now()}`;
    }

    fetch(fetchUrl)
        .then(res => res.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            
            tbody.innerHTML = '';
            document.getElementById('i-next').disabled = data.filings.length < 50;
            const offset = (page - 1) * 50;
            
            if (data.filings.length === 0) {
                tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;">No Form 4 filings found.</td></tr>`;
                return;
            }
            
            data.filings.forEach((f, i) => {
                const cikStripped = String(f.cik).replace(/^0+/, '');
                const accStripped = String(f.accession_no).replace(/-/g, '');
                const secHtmlUrl = `https://www.sec.gov/Archives/edgar/data/${cikStripped}/${accStripped}/${f.accession_no}-index.html`;

                tbody.innerHTML += `<tr>
                    <td>${offset + i + 1}</td>
                    <td><span class="badge" style="background: #0070f3; color: white;">${f.form}</span></td>
                    <td style="font-weight: bold;">${f.company}</td>
                    <td class="mono">${f.cik}</td>
                    <td>${f.report_period}</td> 
                    <td>${f.date}</td>
                    <td class="mono">
                        <a href="javascript:void(0);" onclick="openInsiderDocument('${f.company.replace(/'/g, "\\'")}', '${f.form}', '${f.date}', '${f.accession_no}', '${secHtmlUrl}')" 
                           style="color: #0070f3; text-decoration: underline; font-weight: bold;" title="View Details">
                            ${f.accession_no}
                        </a>
                    </td>
                    <td style="display: flex; gap: 8px;">
                        <button onclick="openInsiderDocument('${f.company.replace(/'/g, "\\'")}', '${f.form}', '${f.date}', '${f.accession_no}', '${secHtmlUrl}')" 
                                class="btn-primary" style="padding: 4px 8px; font-size: 11px;">
                            View Details
                        </button>
                        <a href="${secHtmlUrl}" target="_blank" class="btn-primary" style="padding: 4px 8px; font-size: 11px; text-decoration: none; background: #666;">View SEC ↗</a>
                    </td>
                </tr>`;
            });
            
            updateTimestamp();
        })
        .catch(err => {
            tbody.innerHTML = `<tr><td colspan="8" style="color:red; text-align:center;">Error: ${err.message}</td></tr>`;
        });
}

function changeInsiderPage(dir) {
    if (currentInsiderPage + dir > 0) loadInsiderFilings(currentInsiderPage + dir);
}

// --- FORM D STATE & LOGIC ---
let currentFormDPage = 1;

function showFormDView(fetchData = true, updateUrl = true, resetPage = false) {
    if (resetPage) currentFormDPage = 1;

    // 1. Wipe the entire canvas clean instantly
    hideAllViews();
    
    // 2. Open the Form D master list panel states explicitly
    document.getElementById('formd-view').style.display = 'block';
    document.getElementById('back-btn').style.display = 'none';
    document.getElementById('filings-controls').style.display = 'flex'; 
    document.getElementById('page-title').innerText = "Latest Form D Offerings";
    
    if (fetchData) loadFormDFilings(currentFormDPage);
}

function loadFormDFilings(page) {
    currentFormDPage = page;
    document.getElementById('d-ind').innerText = `Page ${page}`;
    document.getElementById('d-prev').disabled = page === 1;

    const tbody = document.getElementById('formd-body');
    tbody.innerHTML = `<tr><td colspan="8" class="loading">Loading page ${page}...</td></tr>`;

    let fetchUrl = `/api/filings/formd?page=${page}`;
    if (page === 1) fetchUrl += `&_t=${Date.now()}`; // Cache buster for the freshest data

    fetch(fetchUrl)
        .then(res => res.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            
            tbody.innerHTML = '';
            document.getElementById('d-next').disabled = data.filings.length < 50;
            const offset = (page - 1) * 50;
            
            if (data.filings.length === 0) {
                tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;">No Form D filings found.</td></tr>`;
                return;
            }
            
            data.filings.forEach((f, i) => {
                const cikStripped = String(f.cik).replace(/^0+/, '');
                const accStripped = String(f.accession_no).replace(/-/g, '');
                const secHtmlUrl = `https://www.sec.gov/Archives/edgar/data/${cikStripped}/${accStripped}/${f.accession_no}-index.html`;

                const badgeStyle = f.form === 'D/A' 
                    ? 'background: #9c27b0; color: white;' 
                    : 'background: #673ab7; color: white;';

                // CHANGED: Wired up custom detail loader tracking parameters safely
                tbody.innerHTML += `<tr style="cursor: pointer;">
                    <td>${offset + i + 1}</td>
                    <td><span class="badge" style="${badgeStyle}">${f.form}</span></td>
                    <td style="font-weight: bold; color: #111;">${f.company}</td>
                    <td class="mono">${f.cik}</td>
                    <td>${f.report_period}</td> 
                    <td>${f.date}</td>
                    <td class="mono">
                        <a href="javascript:void(0);" onclick="openFormDDocument('${f.company.replace(/'/g, "\\'")}', '${f.form}', '${f.date}', '${f.accession_no}', '${secHtmlUrl}')" 
                        style="color: #673ab7; text-decoration: underline; font-weight: bold;">
                            ${f.accession_no}
                        </a>
                    </td>
                    <td style="display: flex; gap: 8px;">
                        <button onclick="openFormDDocument('${f.company.replace(/'/g, "\\'")}', '${f.form}', '${f.date}', '${f.accession_no}', '${secHtmlUrl}')" 
                                class="btn-primary" style="padding: 4px 8px; font-size: 11px; background: #673ab7;">
                            View Offering
                        </button>
                        <a href="${secHtmlUrl}" target="_blank" class="btn-primary" style="padding: 4px 8px; font-size: 11px; text-decoration: none; background: #666;">View SEC ↗</a>
                    </td>
                </tr>`;
            });
            
            updateTimestamp();
        })
        .catch(err => {
            tbody.innerHTML = `<tr><td colspan="8" style="color:red; text-align:center;">Error: ${err.message}</td></tr>`;
        });
}

function changeFormDPage(dir) {
    if (currentFormDPage + dir > 0) loadFormDFilings(currentFormDPage + dir);
}

// --- NEW DATA FETCHER ---
function loadCompanyOverview(cik, page = 1, updateUrl = true) {
    currentOverviewPage = page;

    if (updateUrl) {
        const url = new URL(window.location);
        url.searchParams.set('module', 'overview');
        url.searchParams.set('cik', cik);
        url.searchParams.set('page', page);
        window.history.pushState({ module: 'overview', cik: cik, page: page }, '', url);
    }

    hideAllViews();

    document.getElementById('nav-13f').classList.remove('active');
    if (document.getElementById('nav-corp')) document.getElementById('nav-corp').classList.remove('active');
    if (document.getElementById('nav-insider')) document.getElementById('nav-insider').classList.remove('active');
    if (document.getElementById('nav-formd')) document.getElementById('nav-formd').classList.remove('active');
    if (document.getElementById('nav-13d')) document.getElementById('nav-13d').classList.remove('active');

    // Close dropdown and reset search
    document.getElementById('search-dropdown').style.display = 'none';
    document.getElementById('global-search-input').value = "";
    
    // Turn off live refresh
    document.getElementById('auto-refresh-cb').checked = false;
    toggleLiveMode();
    
    // 2. Set up the local overview view states directly here
    document.getElementById('overview-view').style.display = 'block';
    document.getElementById('back-btn').style.display = 'none';
    document.getElementById('filings-controls').style.display = 'none';
    
    document.getElementById('page-title').innerText = "Company Overview";
    document.getElementById('ov-name').innerText = "Fetching SEC Database...";
    
    const tbody = document.getElementById('overview-body');
    tbody.innerHTML = `<tr><td colspan="6" class="loading">Loading comprehensive history for CIK ${cik}...</td></tr>`;

    // Initialize local pagination markers dynamically
    document.getElementById('ov-ind').innerText = `Page ${page}`;
    document.getElementById('ov-prev').disabled = page === 1;
    document.getElementById('ov-next').disabled = true;

    const filterValue = document.getElementById('overview-form-filter') ? document.getElementById('overview-form-filter').value : "ALL";

    fetch(`/api/company/${cik}/overview?form_filter=${encodeURIComponent(filterValue)}&page=${currentOverviewPage}`)
        .then(res => res.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            
            // Map Broad Corporate Metadata Panel
            const d = data.details;
            document.getElementById('page-title').innerText = d.name;
            document.getElementById('ov-name').innerText = d.name;
            document.getElementById('ov-cik').innerText = d.cik;
            document.getElementById('ov-cat').innerText = d.category;
            document.getElementById('ov-fye').innerText = d.fiscal_year;
            document.getElementById('ov-inc').innerText = d.incorporated;
            document.getElementById('ov-phone').innerText = d.phone;
            document.getElementById('ov-add').innerText = d.address;

            // Unlock next page button iteratively
            document.getElementById('ov-next').disabled = !data.has_more;
            
            // Rebuild rows inside the data view engine
            renderOverviewTableData(data.filings || [], page);
        })
        .catch(err => {
            tbody.innerHTML = `<tr><td colspan="6" style="color:red; text-align:center;">Error: ${err.message}</td></tr>`;
        });
}

function renderOverviewTableData(filingsArray, page = 1) {
    const tbody = document.getElementById('overview-body');
    const companyName = document.getElementById('ov-name').innerText;
    tbody.innerHTML = '';
    
    if (filingsArray.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:#666;">No filings found matching your filtering parameters for this index page.</td></tr>`;
        return;
    }

    const offset = (page - 1) * 40;

    filingsArray.forEach((f, i) => {
        const cikStr = document.getElementById('ov-cik').innerText;
        const cikStripped = String(cikStr).replace(/^0+/, '');
        const accStripped = String(f.accession_no).replace(/-/g, '');
        const secHtmlUrl = `https://www.sec.gov/Archives/edgar/data/${cikStripped}/${accStripped}/${f.accession_no}-index.html`;

        const formUpper = f.form.toUpperCase();
        
        // Map supported internal deep dive targets
        const is13F = formUpper === '13F-HR';
        const isCorp = formUpper === '10-K' || formUpper === '10-Q';
        const isInsider = formUpper === '4' || formUpper === '4/A';
        const is13D = formUpper === 'SCHEDULE 13D' || formUpper === 'SCHEDULE 13D/A';
        const isFormD = formUpper === 'D' || formUpper === 'D/A';
        
        const isTerminalViewable = is13F || isCorp || isInsider || is13D || isFormD;

        // Dynamic badge logic assignment
        let badgeStyle = "background: #e0e0e0; color: #333;";
        if (is13F) badgeStyle = "background: #2e7d32; color: white;";
        else if (isCorp) badgeStyle = f.form === '10-K' ? 'background: #4a148c; color: white;' : 'background: #ff9800; color: white;';
        else if (isInsider) badgeStyle = "background: #0070f3; color: white;";
        else if (is13D) badgeStyle = "background: #e91e63; color: white;";
        else if (isFormD) badgeStyle = "background: #673ab7; color: white;";
        else if (formUpper.includes('8-K')) badgeStyle = "background: #c62828; color: white;";

        let clickActionAttr = "";
        let rowCursorStyle = "";
        let cellDecoration = "";

        const safeCompany = companyName.replace(/'/g, "\\'");
        const reportPeriod = f.report_period || "N/A";

        // Bind interactive target actions if supported natively by the terminal view model layout structures
        if (isTerminalViewable) {
            rowCursorStyle = "cursor: pointer;";
            cellDecoration = "color: #0070f3; font-weight: bold;";
            
            if (is13F) {
                clickActionAttr = `onclick="fetchHoldings('${f.accession_no}')"`;
            } else if (isCorp) {
                clickActionAttr = `onclick="openCorporateDocument('${safeCompany}', '${f.form}', '${reportPeriod}', '${f.date}', '${f.accession_no}', '${secHtmlUrl}')"`;
            } else if (isInsider) {
                clickActionAttr = `onclick="openInsiderDocument('${safeCompany}', '${f.form}', '${f.date}', '${f.accession_no}', '${secHtmlUrl}')"`;
            } else if (is13D) {
                clickActionAttr = `onclick="open13DDocument('${safeCompany}', '${f.date}', '${f.accession_no}', '${secHtmlUrl}')"`;
            } else if (isFormD) {
                clickActionAttr = `onclick="openFormDDocument('${safeCompany}', '${f.form}', '${f.date}', '${f.accession_no}', '${secHtmlUrl}')"`;
            }
        }

       let actionButtonHtml = `<a href="${secHtmlUrl}" target="_blank" class="btn-primary" style="padding: 4px 8px; font-size: 11px; text-decoration: none; background: #666;" onclick="event.stopPropagation();">SEC ↗</a>`;
        if (isTerminalViewable) {
            actionButtonHtml = `<button class="btn-primary" style="padding: 4px 8px; font-size: 11px; background: #0070f3; margin-right: 4px;">Open</button>${actionButtonHtml}`;
        }

        tbody.innerHTML += `<tr style="${rowCursorStyle}" ${clickActionAttr}>
            <td>${offset + i + 1}</td>
            <td><span class="badge" style="${badgeStyle}">${f.form}</span></td>
            <td>${reportPeriod}</td> 
            <td>${f.date}</td>
            <td class="mono" style="${cellDecoration}">${f.accession_no}</td>
            <td style="display: flex; gap: 4px;">${actionButtonHtml}</td>
        </tr>`;
    });
}

function changeOverviewPage(dir) {
    const targetCik = document.getElementById('ov-cik').innerText;
    if (targetCik && targetCik !== '-') {
        loadCompanyOverview(targetCik, currentOverviewPage + dir);
    }
}

function filterOverviewTable() {
    const targetCik = document.getElementById('ov-cik').innerText;
    if (targetCik && targetCik !== '-') {
        loadCompanyOverview(targetCik, 1); // Jump straight back to page 1 on filter changes
    }
}

// --- CORPORATE VIEWER STATE ---
let currentFinancialData = { income: [], balance: [], cash: [] };

function openCorporateDocument(company, form, period, date, accession_no, secUrl, updateUrl = true) {
    isTrendMode = false;
    isSegmentMode = false;
    trendCache = { income: null, balance: null, cash: null };
    splitsCache = [];

    // Capture context state BEFORE wiping views or changing URLs
    const urlParams = new URLSearchParams(window.location.search);
    const currentMod = urlParams.get('module');
    const currentCik = urlParams.get('cik');

    hideAllViews();

    if (document.getElementById('trend-btn')) {
        document.getElementById('trend-btn').innerText = "Show 5-Year Trend";
        document.getElementById('trend-btn').style.background = "#1976d2";
    }

    const safeCompany = company && company !== 'undefined' ? company : "Unknown Company";
    const safeForm = form && form !== 'undefined' ? form : "N/A";
    const safePeriod = period && period !== 'undefined' ? period : "N/A";
    const safeDate = date && date !== 'undefined' ? date : "N/A";
    const safeAcc = accession_no && accession_no !== 'undefined' ? accession_no : "N/A";

    if (updateUrl) {
        const url = new URL(window.location);
        url.searchParams.set('module', 'corp');
        url.searchParams.set('doc', safeAcc);
        url.searchParams.set('c', safeCompany);
        url.searchParams.set('f', safeForm);
        url.searchParams.set('p', safePeriod);
        url.searchParams.set('d', safeDate);
        url.searchParams.set('s', secUrl);
        
        // If we came from a company profile overview, lock the origin context parameters to the URL string
        if (currentMod === 'overview' && currentCik) {
            url.searchParams.set('origin', 'overview');
            url.searchParams.set('originCik', currentCik);
        }
        window.history.pushState({ doc: safeAcc }, '', url);
    }

    // INTERACTIVE CONTEXT BACK ACTION LOGIC
    const finalUrlParams = new URLSearchParams(window.location.search);
    const origin = finalUrlParams.get('origin');
    const originCik = finalUrlParams.get('originCik');
    const backBtn = document.getElementById('back-btn');

    if (origin === 'overview' && originCik) {
        backBtn.innerText = "← Back to Company Overview";
        backBtn.onclick = () => loadCompanyOverview(originCik, currentOverviewPage);
    } else {
        backBtn.innerText = "← Back to Corporate List";
        backBtn.onclick = () => switchModule(null, 'corp');
    }

    // Show the document view
    document.getElementById('corp-doc-view').style.display = 'block';
    backBtn.style.display = 'block';
    document.getElementById('filings-controls').style.display = 'none';
    document.getElementById('page-title').innerText = "Corporate Financials";

    // 4. Populate metadata safely
    document.getElementById('cd-company-name').innerText = safeCompany;
    document.getElementById('cd-form').innerText = safeForm;
    document.getElementById('cd-period').innerText = safePeriod;
    document.getElementById('cd-date').innerText = safeDate;
    document.getElementById('cd-acc').innerText = safeAcc;

    // Attach the external SEC URL to the new link we added
    document.getElementById('cd-raw-link').href = secUrl;

    // Reset UI and Clear Caches
    if (document.getElementById('fin-ai-output')) document.getElementById('fin-ai-output').style.display = 'none';
    if (document.getElementById('narr-ai-output')) document.getElementById('narr-ai-output').style.display = 'none';
    
    if (typeof currentNarrativeData !== 'undefined') currentNarrativeData = {}; 
    cachedStatementSummaries = {};
    cachedNarrativeSummaries = {};
    
    // BYPASS SEC BLOCKING: Use our FastAPI proxy endpoint instead of secUrl
    document.getElementById('sec-iframe').src = `/api/raw/${accession_no}`;
    
    switchCorpTab('financials');
    
    // Fetch Native Financials
    document.getElementById('financial-table').style.display = 'none';
    document.getElementById('financial-loading').style.display = 'block';
    document.getElementById('financial-loading').innerText = "Extracting XBRL Financials from SEC...";

    fetch(`/api/financials/${accession_no}`)
        .then(res => res.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            currentFinancialData.income = data.income_statement || [];
            currentFinancialData.balance = data.balance_sheet || [];
            currentFinancialData.cash = data.cash_flow || [];

            if (data.kpis) {
                document.getElementById('kpi-banner').style.display = 'grid';
                document.getElementById('kpi-rev').innerText = data.kpis.revenue;
                document.getElementById('kpi-ni').innerText = data.kpis.net_income;
                document.getElementById('kpi-margin').innerText = data.kpis.profit_margin;
                
                // Color code the growth percentages (Green for positive, Red for negative)
                const revG = document.getElementById('kpi-rev-g');
                revG.innerText = data.kpis.revenue_growth !== "N/A" ? `${data.kpis.revenue_growth} YoY` : "N/A";
                revG.style.color = data.kpis.revenue_growth.includes('+') ? '#2e7d32' : (data.kpis.revenue_growth.includes('-') ? '#c62828' : '#666');

                const niG = document.getElementById('kpi-ni-g');
                niG.innerText = data.kpis.ni_growth !== "N/A" ? `${data.kpis.ni_growth} YoY` : "N/A";
                niG.style.color = data.kpis.ni_growth.includes('+') ? '#2e7d32' : (data.kpis.ni_growth.includes('-') ? '#c62828' : '#666');
            }
            
            document.getElementById('financial-loading').style.display = 'none';
            document.getElementById('financial-table').style.display = 'table';
            document.getElementById('statement-selector').value = "income";
            renderSelectedStatement();
        })
        .catch(err => {
            document.getElementById('financial-loading').innerText = `XBRL Error: ${err.message}`;
            document.getElementById('financial-loading').style.color = "red";
        });
}

function openInsiderDocument(company, form, date, accession_no, secUrl, updateUrl = true) {
    const urlParams = new URLSearchParams(window.location.search);
    const currentMod = urlParams.get('module');
    const currentCik = urlParams.get('cik');

    hideAllViews();

    if (updateUrl) {
        const url = new URL(window.location);
        url.searchParams.set('module', 'insider');
        url.searchParams.set('doc', accession_no);
        url.searchParams.set('c', company);
        url.searchParams.set('f', form);
        url.searchParams.set('d', date);
        url.searchParams.set('s', secUrl);
        if (currentMod === 'overview' && currentCik) {
            url.searchParams.set('origin', 'overview');
            url.searchParams.set('originCik', currentCik);
        }
        window.history.pushState({ doc: accession_no }, '', url);
    }

    const finalUrlParams = new URLSearchParams(window.location.search);
    const origin = finalUrlParams.get('origin');
    const originCik = finalUrlParams.get('originCik');
    const backBtn = document.getElementById('back-btn');

    if (origin === 'overview' && originCik) {
        backBtn.innerText = "← Back to Company Overview";
        backBtn.onclick = () => loadCompanyOverview(originCik, currentOverviewPage);
    } else {
        backBtn.innerText = "← Back to Insider List";
        backBtn.onclick = () => switchModule(null, 'insider');
    }
    backBtn.style.display = 'block';

    document.getElementById('insider-doc-view').style.display = 'block';
    document.getElementById('filings-controls').style.display = 'none';
    document.getElementById('page-title').innerText = "Insider Transaction Detail";

    // Basic headers
    document.getElementById('id-company-name').innerText = company;
    document.getElementById('id-form').innerText = form;
    document.getElementById('id-date').innerText = date;
    document.getElementById('id-acc').innerText = accession_no;
    document.getElementById('id-raw-link').href = secUrl;

    const tbody = document.getElementById('insider-table-body');
    const thead = document.getElementById('insider-table-head');
    tbody.innerHTML = '<tr><td class="loading">Extracting Form 4 Details...</td></tr>';

    fetch(`/api/insider/${accession_no}`)
        .then(res => res.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            
            const s = data.summary;
            document.getElementById('id-insider-name').innerText = s.insider_name;
            document.getElementById('id-position').innerText = s.position;
            
            // Format Activity & Color
            const actEl = document.getElementById('id-activity');
            actEl.innerText = s.primary_activity;
            actEl.style.color = s.net_change > 0 ? '#2e7d32' : (s.net_change < 0 ? '#c62828' : '#111');

            // Format 10b5-1 Plan detection
            const planEl = document.getElementById('id-10b51');
            if (s.has_10b5_1_plan) {
                planEl.innerText = "Scheduled Trade (10b5-1 Plan)";
                planEl.style.color = "#ff9800";
            } else {
                planEl.innerText = "Discretionary Trade";
                planEl.style.color = "#0070f3";
            }

            // Format Financials
            document.getElementById('id-net-value').innerText = s.net_value !== 0 ? `$${Math.abs(s.net_value).toLocaleString('en-US')}` : '-';
            document.getElementById('id-remaining').innerText = s.remaining_shares > 0 ? s.remaining_shares.toLocaleString('en-US') : '-';

            // Build Transaction Table dynamically
            if (data.transactions.length === 0) {
                tbody.innerHTML = '<tr><td style="text-align:center;">No parsed transaction data available.</td></tr>';
                return;
            }

            const keys = Object.keys(data.transactions[0]);
            thead.innerHTML = `<tr>${keys.map(k => `<th>${k}</th>`).join('')}</tr>`;
            
            tbody.innerHTML = '';
            data.transactions.forEach(row => {
                let tr = '<tr>';
                keys.forEach(k => {
                    let val = row[k];
                    // Clean up formatting
                    if (typeof val === 'number') {
                        // Assume it's currency if the key has "price" or "value"
                        if (k.toLowerCase().includes('price') || k.toLowerCase().includes('value')) {
                            val = `$${val.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
                        } else {
                            val = val.toLocaleString('en-US'); // Regular share count
                        }
                    }
                    tr += `<td ${typeof row[k] === 'number' ? 'class="num"' : ''}>${val}</td>`;
                });
                tr += '</tr>';
                tbody.innerHTML += tr;
            });
        })
        .catch(err => {
            tbody.innerHTML = `<tr><td style="color:red; text-align:center;">Error: ${err.message}</td></tr>`;
        });
}

// --- NARRATIVE EXPLORER STATE ---
let currentNarrativeData = {};

function switchCorpTab(tab) {
    document.getElementById('tab-financials').style.display = tab === 'financials' ? 'block' : 'none';
    document.getElementById('tab-raw').style.display = tab === 'raw' ? 'block' : 'none';
    
    // Narrative uses 'flex' instead of 'block' for the sidebar layout
    document.getElementById('tab-narrative').style.display = tab === 'narrative' ? 'flex' : 'none'; 
    
    // Lazy-load the narrative data only when the user clicks the tab for the first time
    if (tab === 'narrative' && Object.keys(currentNarrativeData).length === 0) {
        const accNo = document.getElementById('cd-acc').innerText;
        loadNarrativeExplorer(accNo);
    }
}

let activeNarrativeKey = "";

function loadNarrativeExplorer(accession_no) {
    const sidebar = document.getElementById('narrative-sidebar');
    const content = document.getElementById('narrative-content');
    
    sidebar.innerHTML = '<div class="loading">Extracting SEC text...</div>';
    content.innerHTML = '<h3 style="margin-top: 0; color: #888;">Loading document sections...</h3>';
    
    fetch(`/api/narrative/${accession_no}`)
        .then(res => res.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            
            currentNarrativeData = data.sections || {};
            sidebar.innerHTML = '<strong style="display: block; margin-bottom: 15px; color: #111; font-size: 14px;">Document Index</strong>';
            
            const keys = Object.keys(currentNarrativeData);
            if (keys.length === 0) {
                sidebar.innerHTML += '<div style="color: red; font-size: 13px;">No narrative sections found.</div>';
                content.innerHTML = '';
                return;
            }
            
            keys.forEach((key, index) => {
                const btn = document.createElement('button');
                btn.innerText = key;
                btn.style.cssText = "display: block; width: 100%; text-align: left; padding: 10px; margin-bottom: 8px; background: white; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; font-size: 13px; transition: all 0.2s;";
                
                btn.onclick = () => {
                    Array.from(sidebar.getElementsByTagName('button')).forEach(b => {
                        b.style.backgroundColor = 'white'; b.style.borderColor = '#ccc'; b.style.fontWeight = 'normal';
                    });
                    btn.style.backgroundColor = '#f3e5f5'; btn.style.borderColor = '#4a148c'; btn.style.fontWeight = 'bold';
                    
                    // Track which section is currently active for the AI
                    activeNarrativeKey = key;
                    const formattedText = currentNarrativeData[key].replace(/\n/g, '<br>');
                    
                    // INJECT THE AI BUTTON DIRECTLY INTO THE HEADER!
                    content.innerHTML = `
                        <h2 style="margin-top:0; color:#111; border-bottom: 2px solid #eee; padding-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                            <span>${key}</span>
                            <button id="narr-ai-btn" class="btn-primary" style="background: #4a148c; font-size: 12px; padding: 6px 10px;" onclick="triggerNarrativeSummary()">Summarize Section</button>
                        </h2>
                        <div id="narr-ai-output" style="background: #fdfdfd; border: 1px solid #e0e0e0; padding: 15px; border-radius: 6px; margin-bottom: 20px; display: none; font-size: 14px; line-height: 1.6; color: #333;"></div>
                        <div style="margin-top: 20px;">${formattedText}</div>
                    `;
                    content.scrollTop = 0;
                };
                sidebar.appendChild(btn);
                if (index === 0) btn.click();
            });
        })
        .catch(err => sidebar.innerHTML = `<div style="color:red; font-size: 13px;">Error: ${err.message}</div>`);
}

// 2. NEW FUNCTION: Summarize specific Financial Statements
function triggerStatementSummary() {
    const outputBox = document.getElementById('fin-ai-output');
    const aiBtn = document.getElementById('fin-ai-btn');
    const selection = document.getElementById('statement-selector');
    const statementName = selection.options[selection.selectedIndex].text;
    
    // 1. CHECK CACHE FIRST
    if (cachedStatementSummaries[statementName]) {
        outputBox.style.display = 'block';
        outputBox.innerHTML = marked.parse(cachedStatementSummaries[statementName]);
        outputBox.style.color = "#333";
        outputBox.style.fontStyle = "normal";
        return;
    }

    const activeData = isTrendMode ? trendCache[selection.value] : currentFinancialData[selection.value];
    const rawData = activeData || [];
    const cleanData = rawData.slice(0, 30).map(row => {
        let cleanRow = { label: row.label };
        Object.keys(row).forEach(k => { if (/^\d{4}-\d{2}-\d{2}/.test(k)) cleanRow[k] = row[k]; });
        return cleanRow;
    });

    outputBox.style.display = 'block';
    aiBtn.disabled = true; aiBtn.innerText = "Analyzing...";
    outputBox.innerText = `Llama 3.3 is analyzing the ${statementName}...`;
    outputBox.style.color = "#666"; outputBox.style.fontStyle = "italic";

    fetch('/api/summarize-statement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            company_name: document.getElementById('cd-company-name').innerText,
            form_type: document.getElementById('cd-form').innerText,
            statement_name: statementName,
            table_data: cleanData
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        
        // 2. SAVE TO CACHE
        cachedStatementSummaries[statementName] = data.summary;
        
        outputBox.innerHTML = marked.parse(data.summary);
        outputBox.style.color = "#333"; outputBox.style.fontStyle = "normal";
    })
    .catch(err => {
        outputBox.innerText = `Analysis Failed: ${err.message}`;
        outputBox.style.color = "#c62828"; outputBox.style.fontStyle = "normal";
    })
    .finally(() => { aiBtn.disabled = false; aiBtn.innerText = "Summarize Statement"; });
}

// 3. NEW FUNCTION: Summarize specific Narrative Sections
function triggerNarrativeSummary() {
    const outputBox = document.getElementById('narr-ai-output');
    const aiBtn = document.getElementById('narr-ai-btn');
    
    // 1. CHECK CACHE FIRST
    if (cachedNarrativeSummaries[activeNarrativeKey]) {
        outputBox.style.display = 'block';
        outputBox.innerHTML = marked.parse(cachedNarrativeSummaries[activeNarrativeKey]);
        outputBox.style.color = "#333";
        outputBox.style.fontStyle = "normal";
        return;
    }

    const payloadText = currentNarrativeData[activeNarrativeKey];
    outputBox.style.display = 'block';
    aiBtn.disabled = true; aiBtn.innerText = "Reading text...";
    outputBox.innerText = `Llama 3.3 is reading "${activeNarrativeKey}"...`;
    outputBox.style.color = "#666"; outputBox.style.fontStyle = "italic";

    fetch('/api/summarize-narrative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            company_name: document.getElementById('cd-company-name').innerText,
            form_type: document.getElementById('cd-form').innerText,
            section_title: activeNarrativeKey,
            text_payload: payloadText
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        
        // 2. SAVE TO CACHE
        cachedNarrativeSummaries[activeNarrativeKey] = data.summary;
        
        outputBox.innerHTML = marked.parse(data.summary);
        outputBox.style.color = "#333"; outputBox.style.fontStyle = "normal";
    })
    .catch(err => {
        outputBox.innerText = `Analysis Failed: ${err.message}`;
        outputBox.style.color = "#c62828"; outputBox.style.fontStyle = "normal";
    })
    .finally(() => { aiBtn.disabled = false; aiBtn.innerText = "Summarize Section"; });
}

// --- SEGMENT STATE ---
let isSegmentMode = false;

function toggleSegmentView() {
    isSegmentMode = !isSegmentMode;
    const btn = document.getElementById('segment-btn');
    
    if (isSegmentMode) {
        btn.innerText = "Hide Segments";
        btn.style.background = "#7b1fa2"; // Darker purple when active
    } else {
        btn.innerText = "Show Segments";
        btn.style.background = "#9c27b0"; // Default purple
    }
    
    renderSelectedStatement(); 
}

function toggleTrendView() {
    isTrendMode = !isTrendMode;
    const btn = document.getElementById('trend-btn');
    
    if (isTrendMode) {
        btn.innerText = "Show Current Filing Only";
        btn.style.background = "#d32f2f"; // Red when active
    } else {
        btn.innerText = "Show 5-Year Trend";
        btn.style.background = "#1976d2"; // Blue when inactive
    }
    
    renderSelectedStatement(); 
}

function renderSelectedStatement() {
    const selection = document.getElementById('statement-selector').value;
    const thead = document.getElementById('financial-head');
    const tbody = document.getElementById('financial-body');
    const loading = document.getElementById('financial-loading');

    // Grab all three action buttons
    const aiBtn = document.getElementById('fin-ai-btn');
    const segmentBtn = document.getElementById('segment-btn');
    const trendBtn = document.getElementById('trend-btn');

    // Hide AI box when switching views
    if(document.getElementById('fin-ai-output')) document.getElementById('fin-ai-output').style.display = 'none';

    // NEW HELPER: Dynamically manage ALL button states (Loading, Empty, and Feature Availability)
    const updateButtonStates = (dataArray, isLoading) => {
        
        // 1. Manage AI Summary Button
        if (isLoading || !dataArray || dataArray.length === 0) {
            aiBtn.disabled = true;
            aiBtn.style.opacity = '0.5';
            aiBtn.style.cursor = 'not-allowed';
            aiBtn.title = isLoading ? "Loading data..." : "Statement data is not available.";
        } else {
            aiBtn.disabled = false;
            aiBtn.style.opacity = '1';
            aiBtn.style.cursor = 'pointer';
            aiBtn.title = "Summarize this statement with AI";
        }

        // 2. Manage 'Show Segments' Button
        // Scan the data to see if ANY row is actually a dimensional segment
        const hasSegments = dataArray && dataArray.some(row => row.dimension === true || row.dimension === "True" || row.dimension === "true");
        
        if (isLoading || !hasSegments) {
            segmentBtn.disabled = true;
            segmentBtn.style.opacity = '0.5';
            segmentBtn.style.cursor = 'not-allowed';
            segmentBtn.title = isLoading ? "Loading data..." : "No dimensional segments available in this statement.";
        } else {
            segmentBtn.disabled = false;
            segmentBtn.style.opacity = '1';
            segmentBtn.style.cursor = 'pointer';
            segmentBtn.title = "Toggle dimensional breakdowns";
        }

        // 3. Manage '5-Year Trend' Button
        if (isLoading) {
            trendBtn.disabled = true;
            trendBtn.style.opacity = '0.5';
            trendBtn.style.cursor = 'not-allowed';
            trendBtn.title = "Stitching history...";
        } else {
            trendBtn.disabled = false;
            trendBtn.style.opacity = '1';
            trendBtn.style.cursor = 'pointer';
            trendBtn.title = isTrendMode ? "Return to single filing view" : "Fetch 5-year historical trend";
        }
    };

    if (isTrendMode) {
        if (trendCache[selection]) {
            buildFinancialTable(trendCache[selection], thead, tbody);
            updateButtonStates(trendCache[selection], false); 
            
            // SHOW BANNER IF SPLITS EXIST IN CACHE
            if (splitsCache.length > 0) {
                document.getElementById('split-banner').style.display = 'flex';
                document.getElementById('split-text').innerText = splitsCache.map(s => `a ${s.ratio_str} split on ${s.date}`).join(' and ');
            }
        } else {
            // Fetch 5-Year Data dynamically
            thead.innerHTML = '';
            tbody.innerHTML = '';
            loading.style.display = 'block';
            loading.innerText = `Stitching 5 years of ${selection} history...`;
            document.getElementById('financial-table').style.display = 'none';
            updateButtonStates(null, true); 
            
            const accNo = document.getElementById('cd-acc').innerText;
            
            fetch(`/api/trends/${accNo}/${selection}`)
                .then(res => res.json())
                .then(data => {
                    if (data.error) throw new Error(data.error);
                    
                    // Cache both the table data AND the split metadata
                    trendCache[selection] = data.trend_data;
                    if (data.splits && data.splits.length > 0) splitsCache = data.splits;
                    
                    loading.style.display = 'none';
                    document.getElementById('financial-table').style.display = 'table';
                    buildFinancialTable(data.trend_data, thead, tbody);
                    updateButtonStates(data.trend_data, false);
                    
                    // SHOW BANNER IF NEW SPLITS FETCHED
                    if (splitsCache.length > 0) {
                        document.getElementById('split-banner').style.display = 'flex';
                        document.getElementById('split-text').innerText = splitsCache.map(s => `a ${s.ratio_str} split on ${s.date}`).join(' and ');
                    }
                })
                .catch(err => {
                    loading.innerText = `Trend Error: ${err.message}`;
                    loading.style.color = "red";
                    updateButtonStates(null, false); 
                });
        }
    } else {
        // Standard Single Filing View
        document.getElementById('split-banner').style.display = 'none'; // ALWAYS HIDE IN SINGLE VIEW
        const currentData = currentFinancialData[selection] || [];
        buildFinancialTable(currentData, thead, tbody);
        updateButtonStates(currentData, false); 
    }
}

// Extracted the HTML building logic so it can handle ANY dataframe seamlessly
function buildFinancialTable(data, thead, tbody) {
    thead.innerHTML = '';
    tbody.innerHTML = '';
    
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td class="loading">Statement not available.</td></tr>';
        return;
    }

    // 1. FILTER DATA BASED ON SEGMENT MODE
    let displayData = data;
    if (!isSegmentMode) {
        // Hide all rows where XBRL 'dimension' is True
        displayData = data.filter(row => row.dimension !== true && row.dimension !== "True" && row.dimension !== "true");
    }

    const allKeys = Object.keys(data[0]);
    const displayCols = ['label', ...allKeys.filter(k => /^(FY|CY)?\s?\d{4}/.test(k))];

    let headHtml = '<tr>';
    displayCols.forEach(col => {
        const title = col === 'label' ? 'Line Item' : col;
        headHtml += `<th>${title}</th>`;
    });
    
    if (isTrendMode) headHtml += `<th style="text-align: center;">5-Yr Trend</th>`;
    headHtml += '</tr>';
    thead.innerHTML = headHtml;

    displayData.forEach(row => {
        const level = row.level !== undefined ? row.level : (row.depth || 0);
        const indent = level > 0 ? '&nbsp;&nbsp;&nbsp;&nbsp;'.repeat(level) : '';
        const isAbstract = row.abstract === true || row.is_abstract === true; 
        
        // Check if this row is a dimensional segment breakdown
        const isDimension = row.dimension === true || row.dimension === "True" || row.dimension === "true";
        
        let rowHtml = `<tr style="${isAbstract ? 'font-weight: bold; background-color: #f9f9f9;' : ''}">`;
        let rowValues = []; 

        displayCols.forEach(col => {
            let val = row[col];
            
            if (col !== 'label' && !isAbstract && !isDimension) {
                if (typeof val === 'number') rowValues.push(val);
                else rowValues.push(null);
            }

            if (col === 'label') {
                if (isDimension) {
                    // Format dimensional rows as indented, purple sub-items
                    const segmentName = row.dimension_member_label || row.dimension_member || "Segment Breakdown";
                    val = `↳ ${segmentName}`;
                    rowHtml += `<td style="white-space: normal; min-width: 300px; max-width: 450px; line-height: 1.4; color: #9c27b0; padding-left: 40px; font-size: 11px;">${indent}${val}</td>`;
                } else {
                    rowHtml += `<td style="white-space: normal; min-width: 300px; max-width: 450px; line-height: 1.4;">${indent}${val}</td>`;
                }
            } else {
                if (val === "" || val === null || val === undefined) {
                    rowHtml += `<td class="num" style="color: #aaa; text-align: right;">-</td>`;
                } else if (typeof val === 'number') {
                    const formatted = val < 0 ? `(${Math.abs(val).toLocaleString('en-US')})` : val.toLocaleString('en-US');
                    const colorStyle = val < 0 ? 'color: #d32f2f;' : '';
                    
                    // Slightly fade the numbers for segment rows so the main totals stand out
                    const opacityStyle = isDimension ? 'opacity: 0.8;' : '';
                    rowHtml += `<td class="num" style="text-align: right; ${colorStyle} ${opacityStyle}">${formatted}</td>`;
                } else {
                    rowHtml += `<td class="num" style="text-align: right;">${val}</td>`;
                }
            }
        });

        // Add the Sparkline
        if (isTrendMode) {
            if (isAbstract || isDimension) {
                rowHtml += `<td></td>`; 
            } else {
                let validVals = rowValues.filter(v => v !== null).reverse();
                if (validVals.length > 1) {
                    const min = Math.min(...validVals);
                    const max = Math.max(...validVals);
                    const range = max - min === 0 ? 1 : max - min; 
                    const width = 80; const height = 24;
                    
                    let points = validVals.map((val, i) => {
                        const x = (i / (validVals.length - 1)) * width;
                        const y = height - (((val - min) / range) * height);
                        return `${x},${y}`;
                    }).join(' ');

                    const first = validVals[0];
                    const last = validVals[validVals.length - 1];
                    let strokeColor = "#0070f3"; 
                    if (last > first) strokeColor = "#2e7d32"; 
                    if (last < first) strokeColor = "#c62828"; 

                    rowHtml += `<td style="vertical-align: middle; padding: 2px 15px; text-align: center;">
                        <svg width="${width}" height="${height}" style="overflow: visible;">
                            <polyline points="${points}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </td>`;
                } else {
                    rowHtml += `<td style="color: #aaa; text-align: center; font-size: 10px;">-</td>`;
                }
            }
        }
        rowHtml += '</tr>';
        tbody.innerHTML += rowHtml;
    });
}

// --- 13D STATE ---
let current13dPage = 1;

function show13dView(fetchData = true) {

    // 1. Wipe the entire canvas clean instantly
    hideAllViews();

    // 2. Open the Schedule 13D master list panel states explicitly
    document.getElementById('thirteend-view').style.display = 'block';
    document.getElementById('back-btn').style.display = 'none';
    document.getElementById('filings-controls').style.display = 'flex'; 
    document.getElementById('page-title').innerText = "Schedule 13D (Activist/Active)";
    
    if (fetchData) load13dFilings(current13dPage);
}

function load13dFilings(page) {
    current13dPage = page;
    const tbody = document.getElementById('thirteend-body');
    tbody.innerHTML = `<tr><td colspan="6" class="loading">Loading Schedule 13D filings...</td></tr>`;
    
    fetch(`/api/filings/13d?page=${page}`)
        .then(res => res.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            
            tbody.innerHTML = data.filings.map((f, i) => {
                const cikStripped = String(f.cik).replace(/^0+/, '');
                const accStripped = String(f.accession_no).replace(/-/g, '');
                const secHtmlUrl = `https://www.sec.gov/Archives/edgar/data/${cikStripped}/${accStripped}/${f.accession_no}-index.html`;
                const companyName = f.company_name || 'Unknown Issuer';
                const safeCompany = companyName.replace(/'/g, "\\'");

                return `<tr style="cursor: pointer;" onclick="open13DDocument('${safeCompany}', '${f.filing_date}', '${f.accession_no}', '${secHtmlUrl}')">
                    <td>${i + 1}</td>
                    <td><span class="badge" style="background: #e91e63; color: white;">${f.form}</span></td>
                    <td style="font-weight: bold; color: #111;">${companyName}</td>
                    <td class="mono">${f.cik}</td>
                    <td>${f.filing_date}</td> 
                    <td class="mono" style="color: #0070f3; text-decoration: underline;">${f.accession_no}</td>
                </tr>`;
            }).join('');
            
            if (typeof updateTimestamp === 'function') updateTimestamp();
        })
        .catch(err => {
            tbody.innerHTML = `<tr><td colspan="6" style="color:red; text-align:center;">Error: ${err.message}</td></tr>`;
        });
}

// ==========================================
// SCHEDULE 13D ACTIVIST DEEP DIVE VIEW WRAPPER
// ==========================================
function open13DDocument(company, date, accession_no, secUrl, updateUrl = true) {
    const urlParams = new URLSearchParams(window.location.search);
    const currentMod = urlParams.get('module');
    const currentCik = urlParams.get('cik');

    hideAllViews();

    if (updateUrl) {
        const url = new URL(window.location);
        url.searchParams.set('module', '13d');
        url.searchParams.set('doc', accession_no);
        url.searchParams.set('c', company);
        url.searchParams.set('d', date);
        url.searchParams.set('s', secUrl);
        if (currentMod === 'overview' && currentCik) {
            url.searchParams.set('origin', 'overview');
            url.searchParams.set('originCik', currentCik);
        }
        window.history.pushState({ doc: accession_no }, '', url);
    }

    const finalUrlParams = new URLSearchParams(window.location.search);
    const origin = finalUrlParams.get('origin');
    const originCik = finalUrlParams.get('originCik');
    const backBtn = document.getElementById('back-btn');

    if (origin === 'overview' && originCik) {
        backBtn.innerText = "← Back to Company Overview";
        backBtn.onclick = () => loadCompanyOverview(originCik, currentOverviewPage);
    } else {
        backBtn.innerText = "← Back to 13D List";
        backBtn.onclick = () => switchModule(null, '13d');
    }
    backBtn.style.display = 'block';

    // Hide everything else
    document.getElementById('filings-view').style.display = 'none';
    if(document.getElementById('overview-view')) document.getElementById('overview-view').style.display = 'none';
    if(document.getElementById('holdings-view')) document.getElementById('holdings-view').style.display = 'none';
    if(document.getElementById('corporate-view')) document.getElementById('corporate-view').style.display = 'none';
    if(document.getElementById('corp-doc-view')) document.getElementById('corp-doc-view').style.display = 'none';
    if(document.getElementById('formd-view')) document.getElementById('formd-view').style.display = 'none';
    if(document.getElementById('formd-doc-view')) document.getElementById('formd-doc-view').style.display = 'none';
    if(document.getElementById('insider-view')) document.getElementById('insider-view').style.display = 'none';
    if(document.getElementById('insider-doc-view')) document.getElementById('insider-doc-view').style.display = 'none';
    document.getElementById('thirteend-view').style.display = 'none';

    // Show 13D Workspace Panel
    document.getElementById('thirteend-doc-view').style.display = 'block';
    document.getElementById('back-btn').style.display = 'block';
    document.getElementById('filings-controls').style.display = 'none';
    document.getElementById('page-title').innerText = "Activist Venture Campaign Breakdown";

    // Static markers
    document.getElementById('sd-issuer-name').innerText = company;
    document.getElementById('sd-date').innerText = date;
    document.getElementById('sd-acc').innerText = accession_no;
    document.getElementById('sd-raw-link').href = secUrl;

    const purposeBox = document.getElementById('sd-purpose');
    const personsBody = document.getElementById('sd-persons-body');

    purposeBox.innerHTML = '<span class="loading">Extracting structural Item 4 strategic positions...</span>';
    personsBody.innerHTML = '<tr><td colspan="3" class="loading">Parsing beneficiary stake owners...</td></tr>';

    fetch(`/api/13d/${accession_no}`)
        .then(res => res.json())
        .then(data => {
            if (data.error) throw new Error(data.error);

            // Populate Item 4 and Total Percentage
            purposeBox.innerText = data.purpose || "No Item 4 statement filed explicitly or data field is unmappable.";
            document.getElementById('sd-total-percent').innerText = data.total_percent ? `${data.total_percent}%` : "Not Stated";

            // Populate Reporting Whales
            personsBody.innerHTML = '';
            if (!data.reporting_persons || data.reporting_persons.length === 0) {
                personsBody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#888;">No explicit individual tracking files mapped.</td></tr>';
            } else {
                data.reporting_persons.forEach(p => {
                    const cleanAmt = typeof p.amount === 'number' ? p.amount.toLocaleString() : (p.amount || '-');
                    personsBody.innerHTML += `<tr>
                        <td style="font-weight:600; color:#e91e63;">${p.name}</td>
                        <td class="num">${cleanAmt}</td>
                        <td class="num" style="font-weight:bold; color:#111;">${p.percent}%</td>
                    </tr>`;
                });
            }
        })
        .catch(err => {
            purposeBox.innerHTML = `<span style="color:red;">Error loading activist goals: ${err.message}</span>`;
            personsBody.innerHTML = `<tr><td colspan="3" style="color:red;">Failed to resolve parameters.</td></tr>`;
        });
}

// ==========================================
// FORM D COMPREHENSIVE DETAIL DISPLAY LOADER
// ==========================================
function openFormDDocument(company, form, date, accession_no, secUrl, updateUrl = true) {
    const urlParams = new URLSearchParams(window.location.search);
    const currentMod = urlParams.get('module');
    const currentCik = urlParams.get('cik');

    hideAllViews();

    if (updateUrl) {
        const url = new URL(window.location);
        url.searchParams.set('module', 'formd');
        url.searchParams.set('doc', accession_no);
        url.searchParams.set('c', company);
        url.searchParams.set('f', form);
        url.searchParams.set('d', date);
        url.searchParams.set('s', secUrl);
        if (currentMod === 'overview' && currentCik) {
            url.searchParams.set('origin', 'overview');
            url.searchParams.set('originCik', currentCik);
        }
        window.history.pushState({ doc: accession_no }, '', url);
    }

    const finalUrlParams = new URLSearchParams(window.location.search);
    const origin = finalUrlParams.get('origin');
    const originCik = finalUrlParams.get('originCik');
    const backBtn = document.getElementById('back-btn');

    if (origin === 'overview' && originCik) {
        backBtn.innerText = "← Back to Company Overview";
        backBtn.onclick = () => loadCompanyOverview(originCik, currentOverviewPage);
    } else {
        backBtn.innerText = "← Back to Form D List";
        backBtn.onclick = () => switchModule(null, 'formd');
    }
    backBtn.style.display = 'block';

    // Hide all other views
    document.getElementById('filings-view').style.display = 'none';
    if(document.getElementById('overview-view')) document.getElementById('overview-view').style.display = 'none';
    if(document.getElementById('holdings-view')) document.getElementById('holdings-view').style.display = 'none';
    if(document.getElementById('corporate-view')) document.getElementById('corporate-view').style.display = 'none';
    if(document.getElementById('corp-doc-view')) document.getElementById('corp-doc-view').style.display = 'none';
    if(document.getElementById('formd-view')) document.getElementById('formd-view').style.display = 'none';
    if(document.getElementById('insider-view')) document.getElementById('insider-view').style.display = 'none';
    if(document.getElementById('insider-doc-view')) document.getElementById('insider-doc-view').style.display = 'none';

    // Show Form D view workspace structures
    document.getElementById('formd-doc-view').style.display = 'block';
    document.getElementById('back-btn').style.display = 'block';
    document.getElementById('filings-controls').style.display = 'none';
    document.getElementById('page-title').innerText = "Private Placement Offering Breakdown";

    // Set basics static markers info cards
    document.getElementById('fd-company-name').innerText = company;
    document.getElementById('fd-form').innerText = form;
    document.getElementById('fd-acc').innerText = accession_no;
    document.getElementById('fd-raw-link').href = secUrl;

    const relBody = document.getElementById('fd-related-body');
    const salesBody = document.getElementById('fd-sales-body');
    
    relBody.innerHTML = '<tr><td colspan="2" class="loading">Parsing governance roster data matrix...</td></tr>';
    salesBody.innerHTML = '<tr><td colspan="4" class="loading">Parsing intermediary transaction networks...</td></tr>';

    fetch(`/api/formd/${accession_no}`)
        .then(res => res.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            
            const i = data.issuer;
            const o = data.offering;

            // Map Corporate Profiles
            document.getElementById('fd-cik').innerText = i.cik;
            document.getElementById('fd-entity-type').innerText = i.entity_type;
            document.getElementById('fd-jurisdiction').innerText = i.jurisdiction;
            document.getElementById('fd-inc-year').innerText = i.year_of_incorporation;
            document.getElementById('fd-industry').innerText = o.industry_group;
            document.getElementById('fd-revenue-range').innerText = o.revenue_range;
            document.getElementById('fd-sale-date').innerText = o.date_of_first_sale;
            document.getElementById('fd-phone').innerText = i.phone;
            document.getElementById('fd-address').innerText = i.address;

            // Show Startup badge conditionally
            document.getElementById('fd-startup-badge').style.display = i.is_startup ? 'inline-block' : 'none';

            // Clean numerical data tracking conversion parsing helpers [cite: 185]
            const parseVal = (v) => v ? parseFloat(String(v).replace(/[^0-9.-]+/g, "")) : 0;
            const fmtCurr = (v) => {
                const n = parseVal(v);
                return n === 0 ? "Indefinite / Unspecified" : `$${n.toLocaleString('en-US')}`;
            };

            const total = parseVal(o.total_offering);
            const sold = parseVal(o.total_sold);
            const remaining = parseVal(o.total_remaining);

            document.getElementById('fd-total-offering').innerText = fmtCurr(o.total_offering);
            document.getElementById('fd-total-sold').innerText = fmtCurr(o.total_sold);
            document.getElementById('fd-total-remaining').innerText = fmtCurr(o.total_remaining);
            document.getElementById('fd-investors').innerText = o.investor_count ? parseInt(o.investor_count).toLocaleString() : '0';
            document.getElementById('fd-min-investment').innerText = fmtCurr(o.minimum_investment);

            // Dynamic Progress Indicator math engine computations
            let pct = 0;
            if (total > 0) {
                pct = Math.min(((sold / total) * 100), 100);
                document.getElementById('fd-progress-pct').innerText = `${pct.toFixed(1)}% Raised`;
            } else if (sold > 0) {
                document.getElementById('fd-progress-pct').innerText = "Continuous / Open Subscription Raise";
                pct = 100; // Fill bar for continuous offerings
            } else {
                document.getElementById('fd-progress-pct').innerText = "0% Raised";
            }
            document.getElementById('fd-progress-bar').style.width = `${pct}%`;

            // Dynamic Federation Exemption Badges Injection Map [cite: 64, 202]
            const badgeBox = document.getElementById('fd-exemption-badges');
            badgeBox.innerHTML = '';
            if (o.exemptions && o.exemptions.length > 0) {
                o.exemptions.forEach(ex => {
                    badgeBox.innerHTML += `<span class="badge" style="background:#e1bee7; color:#4a148c; font-size:9px;">Rule ${ex}</span>`;
                });
            }

            // Render Related Persons Matrix [cite: 21, 156, 205]
            relBody.innerHTML = '';
            if (data.related_persons.length === 0) {
                relBody.innerHTML = '<tr><td colspan="2" style="text-align:center; color:#888;">No related executive officers logged.</td></tr>';
            } else {
                data.related_persons.forEach(p => {
                    relBody.innerHTML += `<tr>
                        <td style="font-weight:600; color:#111;">${p.name}</td>
                        <td class="mono" style="font-size:11px;">${p.address}</td>
                    </tr>`;
                });
            }

            // Render Intermediary Network Placement Agents Network matrix [cite: 69, 160, 208]
            salesBody.innerHTML = '';
            if (data.sales_recipients.length === 0) {
                salesBody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#888;">Direct placement sale raise execution (No external placement agents utilized).</td></tr>';
            } else {
                data.sales_recipients.forEach(r => {
                    const cleanStates = Array.isArray(r.states) ? r.states.join(', ') : String(r.states);
                    salesBody.innerHTML += `<tr>
                        <td style="font-weight:600; color:#4a148c;">${r.name}</td>
                        <td class="mono">${r.crd}</td>
                        <td style="font-weight:500;">${r.associated_bd}</td>
                        <td style="white-space:normal; max-width:250px; font-size:10px; color:#555; line-height:1.3;">${cleanStates}</td>
                    </tr>`;
                });
            }
        })
        .catch(err => {
            relBody.innerHTML = `<tr><td colspan="2" style="color:red;">Error loading document details: ${err.message}</td></tr>`;
            salesBody.innerHTML = `<tr><td colspan="4" style="color:red;">Error details tracking failed.</td></tr>`;
        });
}


// ==========================================
// BROWSER HISTORY ROUTING
// ==========================================
window.addEventListener('popstate', (event) => {
    const urlParams = new URLSearchParams(window.location.search);
    const currentAcc = urlParams.get('accession');
    const currentDoc = urlParams.get('doc');
    const currentMod = urlParams.get('module') || '13f';
    
    // Strip active classes safely
    document.getElementById('nav-13f').classList.remove('active');
    if (document.getElementById('nav-corp')) document.getElementById('nav-corp').classList.remove('active');
    if (document.getElementById('nav-insider')) document.getElementById('nav-insider').classList.remove('active');
    if (document.getElementById('nav-formd')) document.getElementById('nav-formd').classList.remove('active');
    if (document.getElementById('nav-13d')) document.getElementById('nav-13d').classList.remove('active'); // Added safety clean

    if (currentAcc) {
        document.getElementById('nav-13f').classList.add('active');
        fetchHoldings(currentAcc, false); 
    } else if (currentDoc && currentMod === 'formd') {
        if (document.getElementById('nav-formd')) document.getElementById('nav-formd').classList.add('active');
        openFormDDocument(urlParams.get('c'), urlParams.get('f'), urlParams.get('d'), currentDoc, urlParams.get('s'), false);
    } else if (currentDoc && currentMod === '13d') {
        if (document.getElementById('nav-13d')) document.getElementById('nav-13d').classList.add('active');
        open13DDocument(urlParams.get('c'), urlParams.get('d'), currentDoc, urlParams.get('s'), false);
    } else if (currentDoc && currentMod === 'corp') {
        if (document.getElementById('nav-corp')) document.getElementById('nav-corp').classList.add('active');
        openCorporateDocument(urlParams.get('c'), urlParams.get('f'), urlParams.get('p'), urlParams.get('d'), currentDoc, urlParams.get('s'), false);
    } else if (currentDoc && currentMod === 'insider') {
        if (document.getElementById('nav-insider')) document.getElementById('nav-insider').classList.add('active');
        openInsiderDocument(urlParams.get('c'), urlParams.get('f'), urlParams.get('d'), currentDoc, urlParams.get('s'), false);
    } else if (currentMod === 'overview') {
        // --- ADD THIS EXPLICIT CHECK ---
        const cik = urlParams.get('cik');
        const page = parseInt(urlParams.get('page') || '1');
        if (cik) {
            loadCompanyOverview(cik, page, false); // false prevents pushing a duplicate state
        } else {
            switchModule(null, '13f', false);
        }
    } else {
        switchModule(null, currentMod, false);
    }
});

// ==========================================
// INITIALIZE APP
// ==========================================
const initialUrlParams = new URLSearchParams(window.location.search);
const initialAcc = initialUrlParams.get('accession');
const initialDoc = initialUrlParams.get('doc');
const initialMod = initialUrlParams.get('module') || '13f';

if (initialAcc) {
    document.getElementById('nav-13f').classList.add('active');
    fetchHoldings(initialAcc, false);
} else if (initialDoc && initialMod === 'formd') {
    if (document.getElementById('nav-formd')) document.getElementById('nav-formd').classList.add('active');
    openFormDDocument(initialUrlParams.get('c'), initialUrlParams.get('f'), initialUrlParams.get('d'), initialDoc, initialUrlParams.get('s'), false);
} else if (initialDoc && initialMod === '13d') {
    if (document.getElementById('nav-13d')) document.getElementById('nav-13d').classList.add('active');
    open13DDocument(initialUrlParams.get('c'), initialUrlParams.get('d'), initialDoc, initialUrlParams.get('s'), false);
} else if (initialDoc && initialMod === 'corp') {
    if (document.getElementById('nav-corp')) document.getElementById('nav-corp').classList.add('active');
    openCorporateDocument(initialUrlParams.get('c'), initialUrlParams.get('f'), initialUrlParams.get('p'), initialUrlParams.get('d'), initialDoc, initialUrlParams.get('s'), false);
} else if (initialDoc && initialMod === 'insider') {
    if (document.getElementById('nav-insider')) document.getElementById('nav-insider').classList.add('active');
    openInsiderDocument(initialUrlParams.get('c'), initialUrlParams.get('f'), initialUrlParams.get('d'), initialDoc, initialUrlParams.get('s'), false);
} else if (initialMod === 'overview') {
    // --- ADD THIS CONDITIONAL TO CATCH THE HARD OVERVIEW REFRESH ---
    const initialCik = initialUrlParams.get('cik');
    const initialPage = parseInt(initialUrlParams.get('page') || '1');
    if (initialCik) {
        loadCompanyOverview(initialCik, initialPage, false);
    } else {
        switchModule(null, '13f', false);
    }
} else {
    switchModule(null, initialMod, false);
}