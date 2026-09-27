import os
import sys
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#6B7280"))
        
        # Header (pages > 1)
        if self._pageNumber > 1:
            self.drawString(54, 842 - 36, "BAZAAR SYNC — Commercial Platform Analysis & Futuristic Product Roadmap")
            self.setStrokeColor(colors.HexColor("#E5E7EB"))
            self.setLineWidth(0.5)
            self.line(54, 842 - 42, 595 - 54, 842 - 42)

        # Footer (all pages)
        page_str = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(595 - 54, 30, page_str)
        self.drawString(54, 30, "CONFIDENTIAL & PROPRIETARY — BAZAAR SYNC TECHNOLOGIES")
        self.setStrokeColor(colors.HexColor("#E5E7EB"))
        self.setLineWidth(0.5)
        self.line(54, 40, 595 - 54, 40)
        self.restoreState()

def build_pdf(filename):
    doc = SimpleDocTemplate(
        filename,
        pagesize=A4,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )

    styles = getSampleStyleSheet()
    
    # Custom Brand Colors
    PRIMARY = colors.HexColor("#059669")    # Emerald 600
    PRIMARY_DARK = colors.HexColor("#047857") # Emerald 700
    PRIMARY_LIGHT = colors.HexColor("#ECFDF5")# Emerald 50
    TEXT_MAIN = colors.HexColor("#111827")   # Gray 900
    TEXT_MUTED = colors.HexColor("#4B5563")  # Gray 600
    BORDER_COLOR = colors.HexColor("#D1D5DB")# Gray 300

    # Custom Typography Styles
    styles.add(ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=24,
        leading=28,
        textColor=PRIMARY_DARK,
        spaceAfter=6
    ))

    styles.add(ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=12,
        leading=16,
        textColor=TEXT_MUTED,
        spaceAfter=18
    ))

    styles.add(ParagraphStyle(
        'SectionHeading',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=14,
        leading=18,
        textColor=PRIMARY_DARK,
        spaceBefore=12,
        spaceAfter=6
    ))

    styles.add(ParagraphStyle(
        'BodyDark',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9.5,
        leading=13.5,
        textColor=TEXT_MAIN,
        spaceAfter=6
    ))

    styles.add(ParagraphStyle(
        'BodyMuted',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=12,
        textColor=TEXT_MUTED,
        spaceAfter=4
    ))

    styles.add(ParagraphStyle(
        'FeatureTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=10,
        leading=13,
        textColor=PRIMARY_DARK
    ))

    styles.add(ParagraphStyle(
        'TableHead',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8.5,
        leading=11,
        textColor=colors.white
    ))

    styles.add(ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8,
        leading=11,
        textColor=TEXT_MAIN
    ))

    styles.add(ParagraphStyle(
        'TableCellBold',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=11,
        textColor=TEXT_MAIN
    ))

    story = []

    # -------------------------------------------------------------
    # COVER / HEADER BLOCK
    # -------------------------------------------------------------
    story.append(Paragraph("BAZAAR SYNC vs. STOCKMOJO", styles['DocTitle']))
    story.append(Paragraph("Executive Commercial Platform Analysis, Competitive Benchmark & Futuristic Product Roadmap", styles['DocSubtitle']))
    story.append(HRFlowable(width="100%", thickness=1.5, color=PRIMARY, spaceBefore=0, spaceAfter=12))

    # Executive Metadata Box
    meta_data = [
        [
            Paragraph("<b>Target Domain:</b> Indian Options, Derivatives & Equity Backtesting", styles['TableCell']),
            Paragraph("<b>Target Audience:</b> Retail, HNI, Algo Traders & Prop Desks", styles['TableCell']),
        ],
        [
            Paragraph("<b>Core Benchmark:</b> StockMojo (stockmojo.in), Sensibull, Opstra", styles['TableCell']),
            Paragraph("<b>Status:</b> Commercial Overhaul & Production Readiness", styles['TableCell']),
        ]
    ]
    meta_table = Table(meta_data, colWidths=[240, 247])
    meta_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), PRIMARY_LIGHT),
        ('BOX', (0, 0), (-1, -1), 0.5, PRIMARY),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 12))

    # -------------------------------------------------------------
    # SECTION 1: EXECUTIVE SUMMARY
    # -------------------------------------------------------------
    story.append(Paragraph("1. Executive Summary & Market Positioning", styles['SectionHeading']))
    story.append(Paragraph(
        "<b>Bazaar Sync</b> is architected to become the definitive all-in-one derivatives analytics, strategy building, paper trading, and historical backtesting workstation for the Indian financial markets. While traditional tools like StockMojo, Sensibull, and Opstra charge steep monthly subscriptions for basic charting and delayed simulations, Bazaar Sync combines <b>zero-latency analytical Greeks</b>, <b>intelligent Black-Scholes fallbacks for missing broker feeds</b>, <b>real-time paper execution</b>, and <b>multi-day trade replay</b> into a cohesive, high-performance web experience.",
        styles['BodyDark']
    ))
    story.append(Spacer(1, 8))

    # -------------------------------------------------------------
    # SECTION 2: COMPETITIVE COMPARISON MATRIX
    # -------------------------------------------------------------
    story.append(Paragraph("2. Comprehensive Feature Matrix: Bazaar Sync vs. StockMojo", styles['SectionHeading']))
    
    comp_headers = [
        Paragraph("Feature / Capability", styles['TableHead']),
        Paragraph("StockMojo (stockmojo.in)", styles['TableHead']),
        Paragraph("Bazaar Sync (Our Platform)", styles['TableHead']),
        Paragraph("Competitive Edge", styles['TableHead']),
    ]
    
    comp_rows = [
        [
            Paragraph("<b>Missing Greeks Fallback</b>", styles['TableCellBold']),
            Paragraph("Shows blank/dash '-' when broker feed misses Greeks.", styles['TableCell']),
            Paragraph("<b>Auto Black-Scholes Solver:</b> Dynamically computes IV, Delta, Gamma, Theta, Vega instantly.", styles['TableCell']),
            Paragraph("<b>100% Data Uptime:</b> Zero broken Greeks across 2023-present historical data.", styles['TableCell']),
        ],
        [
            Paragraph("<b>Margin & Equity Calculation</b>", styles['TableCellBold']),
            Paragraph("Generic margin approximations without clear spread hedge discounts.", styles['TableCell']),
            Paragraph("<b>Hedged Margin Engine:</b> Exact SPAN + Exposure breakdown, Funds Required, and <i>'Margin Benefit'</i> savings.", styles['TableCell']),
            Paragraph("<b>Precise Capital Allocation:</b> Traders see exact capital savings on spreads.", styles['TableCell']),
        ],
        [
            Paragraph("<b>Multi-Day Replay & Backtest</b>", styles['TableCellBold']),
            Paragraph("Replay limited to single active day; clearing on navigation.", styles['TableCell']),
            Paragraph("<b>Persistent Trade Replay:</b> Keep positions open across trading days with running MTM P&L.", styles['TableCell']),
            Paragraph("<b>Multi-Day Strategy Testing:</b> Positional Iron Condors / Strangles backtesting.", styles['TableCell']),
        ],
        [
            Paragraph("<b>India VIX & Futures Fallback</b>", styles['TableCellBold']),
            Paragraph("Displays null/empty if exchange VIX OHLC is unavailable.", styles['TableCell']),
            Paragraph("<b>Synthetic ATM IV & Parity Forward:</b> Fallback VIX proxy and Put-Call parity basis.", styles['TableCell']),
            Paragraph("<b>Zero Gaps:</b> Always displays real or synthetic market basis & volatility.", styles['TableCell']),
        ],
        [
            Paragraph("<b>Ready-Made Strategies</b>", styles['TableCellBold']),
            Paragraph("Static list with basic text labels.", styles['TableCell']),
            Paragraph("<b>26 Presets with Live SVG Payoff Curves:</b> Neutral (default), Bullish, Bearish, Volatility with search.", styles['TableCell']),
            Paragraph("<b>Visual Strategy Selection:</b> Instant preview of profit zones and loss tails.", styles['TableCell']),
        ],
        [
            Paragraph("<b>Live Paper Trading</b>", styles['TableCellBold']),
            Paragraph("No integrated live virtual ledger.", styles['TableCell']),
            Paragraph("<b>Complete Paper Trading Brokerage:</b> ₹50k/₹5L virtual margin, one-click trade execution, live ledger.", styles['TableCell']),
            Paragraph("<b>Direct Commercial Monetization:</b> Risk-free learning for retail subscribers.", styles['TableCell']),
        ],
        [
            Paragraph("<b>Multi-Device Responsiveness</b>", styles['TableCellBold']),
            Paragraph("Bulky desktop UI; clumsy on mobile phones and tablets.", styles['TableCell']),
            Paragraph("<b>Mobile-First Segmented Workspace:</b> Dedicated mobile tabs (Chain, Payoff, Positions, Presets).", styles['TableCell']),
            Paragraph("<b>Trade Anywhere:</b> 100% usable on iPhone, iPad, and high-res desktops.", styles['TableCell']),
        ],
    ]

    comp_table = Table([comp_headers] + comp_rows, colWidths=[100, 120, 147, 120])
    comp_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), PRIMARY),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, PRIMARY_LIGHT]),
    ]))
    story.append(comp_table)
    story.append(Spacer(1, 14))

    story.append(PageBreak())

    # -------------------------------------------------------------
    # SECTION 3: 10 FUTURISTIC COMMERCIAL FEATURES TO DOMINATE
    # -------------------------------------------------------------
    story.append(Paragraph("3. Top 10 Futuristic Features & Product Innovations", styles['SectionHeading']))
    story.append(Paragraph(
        "To make Bazaar Sync the most modern, futuristic, and user-friendly platform in India, we propose the following 10 breakthrough features for our next release phases:",
        styles['BodyDark']
    ))
    story.append(Spacer(1, 6))

    features = [
        (
            "1. AI Strategy Copilot & Auto-Adjustment Engine",
            "Real-time AI assistant that monitors active strategies and suggests mathematically optimal adjustments. If Nifty moves 200 points against a Short Straddle, the copilot recommends rolling up the untested put wing to re-center Delta to zero."
        ),
        (
            "2. 1-Click Multi-Leg Broker Order Routing (Dhan, Zerodha, Angel One, Upstox)",
            "Direct API integration allowing users to transition from Backtesting/Paper Trading to real-money execution with a single click. Sends multi-leg basket orders simultaneously to prevent leg slippage."
        ),
        (
            "3. Institutional Big-Bull & Smart Money Order Flow Tracker",
            "Live scanner detecting aggressive institutional option buying (unusual volume sweeps, block trades, massive OI build-ups). Highlights smart money accumulation before major market breakouts."
        ),
        (
            "4. Mathematical Strategy Optimizer & Auto-Strike Finder",
            "Traders input their market outlook, capital, and max risk tolerance. The mathematical optimization engine scans all available expiries and strikes to automatically output the highest Probability of Profit (POP) structure."
        ),
        (
            "5. Live Combined ATM Straddle/Strangle Premium Decay Charts",
            "Real-time chart tracking combined Straddle (CE + PE) price evolution, Theta decay velocity, and Implied Volatility crush after major corporate earnings or RBI Monetary Policy events."
        ),
        (
            "6. Real-Time Option Greeks & Volatility Screener (IV Rank & IV Percentile)",
            "Screening matrix scanning 200+ F&O stocks for high IV Rank (ideal for option selling) and low IV Rank (ideal for option buying), coupled with PCR volume and open interest divergences."
        ),
        (
            "7. Trailing Stop Loss & Multi-Condition Algorithmic Automation",
            "Enables users to automate exits based on technical conditions (e.g., 'Exit strategy if Strategy Delta crosses ±0.30' or 'Square off at 15:15 IST if profit reaches 1.5% of margin')."
        ),
        (
            "8. Community Strategy Marketplace & Verified Leaderboard",
            "Empowers top traders to publish verified backtested strategies. Community members can subscribe, backtest, and replicate trades, creating a powerful viral flywheel and creator revenue stream."
        ),
        (
            "9. Automated Telegram & WhatsApp Live Webhook Alerts",
            "Instant mobile notifications when Max Pain shifts, Straddle breakout levels breach, or automated trailing stop-losses trigger during live market hours."
        ),
        (
            "10. Natural Language / Voice Strategy Command Bar",
            "Futuristic NLP input allowing traders to type or speak commands: <i>'Build a 1:2 Bull Call Ratio Spread on BankNifty with expiry next Thursday'</i> — instantly constructing legs and rendering the payoff diagram in <0.5 seconds."
        ),
    ]

    for title, desc in features:
        feature_box = [
            [
                Paragraph(f"<b>{title}</b>", styles['FeatureTitle']),
            ],
            [
                Paragraph(desc, styles['BodyDark']),
            ]
        ]
        t = Table(feature_box, colWidths=[487])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#F9FAFB")),
            ('BOX', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
            ('LINELEFT', (0, 0), (0, -1), 3, PRIMARY),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ]))
        story.append(t)
        story.append(Spacer(1, 5))

    story.append(PageBreak())

    # -------------------------------------------------------------
    # SECTION 4: COMMERCIAL MONETIZATION BLUEPRINT
    # -------------------------------------------------------------
    story.append(Paragraph("4. Commercial Monetization & SaaS Pricing Blueprint", styles['SectionHeading']))
    story.append(Paragraph(
        "To monetize Bazaar Sync and capture high-margin recurring revenue from Indian retail and institutional traders, we recommend a 3-tier subscription structure:",
        styles['BodyDark']
    ))
    story.append(Spacer(1, 6))

    pricing_headers = [
        Paragraph("Plan Tier", styles['TableHead']),
        Paragraph("Pricing (INR)", styles['TableHead']),
        Paragraph("Included Capabilities", styles['TableHead']),
        Paragraph("Target Segment", styles['TableHead']),
    ]

    pricing_rows = [
        [
            Paragraph("<b>Starter / Free</b>", styles['TableCellBold']),
            Paragraph("₹0 / Free", styles['TableCell']),
            Paragraph("Live Option Chain, basic Strategy Builder (up to 2 legs), 15-min delayed backtest, community access.", styles['TableCell']),
            Paragraph("Beginners & curious traders", styles['TableCell']),
        ],
        [
            Paragraph("<b>Pro Trader</b>", styles['TableCellBold']),
            Paragraph("<b>₹799 / month</b><br/>(₹6,999 / year)", styles['TableCell']),
            Paragraph("0-Latency Live Strategy Builder, unlimited 6-leg positions, full 2023-present Historical Replay, Black-Scholes Greeks engine, Paper Trading ledger (₹5L balance), What-If matrix.", styles['TableCell']),
            Paragraph("Active option sellers & intraday traders", styles['TableCell']),
        ],
        [
            Paragraph("<b>Algo & Pro Alpha</b>", styles['TableCellBold']),
            Paragraph("<b>₹1,999 / month</b><br/>(₹17,999 / year)", styles['TableCell']),
            Paragraph("All Pro features + AI Copilot, 1-Click Multi-Broker Execution Bridge, Institutional Big-Bull Tracker, IV Screener, WhatsApp/Telegram alerts, custom API access.", styles['TableCell']),
            Paragraph("Prop desks, HNIs & full-time derivatives traders", styles['TableCell']),
        ],
    ]

    pricing_table = Table([pricing_headers] + pricing_rows, colWidths=[80, 85, 212, 110])
    pricing_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), PRIMARY),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, PRIMARY_LIGHT]),
    ]))
    story.append(pricing_table)
    story.append(Spacer(1, 14))

    # -------------------------------------------------------------
    # SECTION 5: HISTORICAL DATA & BACKEND SCALABILITY
    # -------------------------------------------------------------
    story.append(Paragraph("5. Historical Data Acquisition Architecture (2023 – Current)", styles['SectionHeading']))
    story.append(Paragraph(
        "To guarantee comprehensive, high-resolution backtesting across 2023 to present without broker rate-limiting issues:",
        styles['BodyDark']
    ))
    
    data_points = [
        ("• Daily EOD Settlements (Bhavcopy):", "Daily NSE official Bhavcopy ingestion providing complete strike matrices, open interest, and settlement prices (cost-free, zero API quota consumption)."),
        ("• 1-Minute & 5-Minute Intraday Backfill (Breeze / Upstox):", "Scheduled parallel backfilling jobs storing historical 1-minute and 5-minute candles in MySQL <code>option_chain_history</code>."),
        ("• Real-Time Memory Cache Layer:", "In-memory caching for live trading hours with automatic disk fallback, delivering sub-10ms response times for active backtesting scrubbers.")
    ]
    for h, b in data_points:
        story.append(Paragraph(f"<b>{h}</b> {b}", styles['BodyDark']))

    story.append(Spacer(1, 12))
    story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY, spaceBefore=6, spaceAfter=8))
    story.append(Paragraph("<b>Report Prepared By:</b> Bazaar Sync AI Engineering Team | <b>Version:</b> 2.4 Commercial Release", styles['BodyMuted']))

    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"PDF successfully generated at: {filename}")

if __name__ == "__main__":
    output_path = "/Applications/XAMPP/xamppfiles/htdocs/bazaar-sync/BazaarSync_vs_StockMojo_Commercial_Report.pdf"
    if len(sys.argv) > 1:
        output_path = sys.argv[1]
    build_pdf(output_path)
