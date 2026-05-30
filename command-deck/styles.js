/* ============================================================
   Command Deck UI kit — style objects (window.K)
   Ported from the product's inline-style system, re-toned to the
   cool / denim-blue palette. Plain JS; loaded before components.
   ============================================================ */
(function () {
  const ink = "#20242e", muted = "#707887", faint = "#a6adba";
  const paper = "#eef1f6", cardBg = "#fbfcfe", line = "#dde2ec";
  const accent = "#2f5d9e", accentSoft = "#eef3fa", accentBorder = "#cdddef";

  window.K = {
    shell: { minHeight: "100vh", background: "radial-gradient(120% 80% at 0% 0%, #f4f7fc 0%, #eef1f6 55%, #e7ecf5 100%)",
             fontFamily: "'Spline Sans', sans-serif", color: ink, padding: "28px clamp(16px,4vw,48px) 48px", animation: "rise .5s ease" },
    header: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 26, maxWidth: 1200, marginInline: "auto" },
    kicker: { textTransform: "uppercase", letterSpacing: "0.22em", fontSize: 11, color: muted, fontWeight: 600 },
    h1: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: "clamp(28px,4vw,42px)", margin: "4px 0 0", letterSpacing: "-0.01em" },
    bigDay: { fontFamily: "'Fraunces', serif", fontSize: 40, fontWeight: 700, lineHeight: 1, color: accent },
    bigMonth: { fontSize: 13, color: muted, fontWeight: 500, letterSpacing: "0.04em" },

    grid: { display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 18, maxWidth: 1200, marginInline: "auto", marginBottom: 18, alignItems: "start" },
    rightCol: { display: "flex", flexDirection: "column", gap: 18 },
    card: { background: cardBg, border: `1px solid ${line}`, borderRadius: 22, padding: "20px 22px",
            boxShadow: "0 10px 30px -26px rgba(30,40,70,0.4)", maxWidth: 1200, marginInline: "auto", width: "100%" },
    cardHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16, gap: 12 },
    h2: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 20, margin: 0, color: ink },
    cardSub: { fontSize: 12.5, color: muted },

    timeline: { display: "flex", flexDirection: "column", gap: 2 },
    tlRow: { display: "grid", gridTemplateColumns: "52px 18px 1fr 24px", gap: 6, alignItems: "stretch" },
    tlTime: { fontSize: 12.5, color: muted, paddingTop: 12, fontVariantNumeric: "tabular-nums", textAlign: "right" },
    tlTimeEnd: { fontSize: 11, color: faint, marginTop: 2 },
    tlMid: { display: "flex", flexDirection: "column", alignItems: "center" },
    tlDot: { width: 12, height: 12, borderRadius: "50%", marginTop: 13, flex: "0 0 auto", boxShadow: "0 0 0 4px rgba(255,255,255,0.7)" },
    tlLine: { width: 2, flex: 1, background: line, marginTop: 2, marginBottom: -2 },
    tlBlock: { textAlign: "left", border: "none", borderRadius: 14, padding: "11px 13px", margin: "5px 0", cursor: "pointer", display: "block", width: "100%" },
    tlBlockTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
    tlTitle: { fontSize: 15, fontWeight: 600, color: ink, lineHeight: 1.3 },
    tlNote: { fontSize: 12.5, color: muted, marginTop: 3, lineHeight: 1.4 },
    tag: { fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 7, display: "inline-block" },
    check: { width: 22, height: 22, borderRadius: "50%", border: "2px solid", display: "flex", alignItems: "center", justifyContent: "center",
             color: "#fff", fontSize: 13, flex: "0 0 auto", fontWeight: 700 },
    del: { background: "none", border: "none", color: faint, fontSize: 20, cursor: "pointer", lineHeight: 1, alignSelf: "center", padding: 0 },
    empty: { fontSize: 13.5, color: muted, fontStyle: "italic", padding: "10px 2px" },

    addBtn: { marginTop: 12, width: "100%", padding: "11px", borderRadius: 12, border: `1px dashed ${line}`,
              background: "transparent", color: muted, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" },
    addPanel: { marginTop: 14, padding: 14, borderRadius: 14, background: paper, display: "flex", flexDirection: "column", gap: 9 },
    addGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 },
    input: { padding: "9px 11px", borderRadius: 10, border: `1px solid ${line}`, fontSize: 14, fontFamily: "inherit", background: "#fff", color: ink, width: "100%" },
    catPick: { display: "flex", gap: 7, flexWrap: "wrap" },
    catChip: { padding: "6px 12px", borderRadius: 20, border: "1.5px solid", fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: "transparent", fontFamily: "inherit" },
    addActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 2 },
    cancelBtn: { padding: "8px 16px", borderRadius: 10, border: `1px solid ${line}`, background: "#fff", color: muted, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" },
    saveBtn: { padding: "8px 18px", borderRadius: 10, border: "none", background: accent, color: "#fff", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" },

    workoutCard: { background: "linear-gradient(135deg, #2f5d9e 0%, #244b80 100%)", border: "none", color: "#fff" },
    woTitle: { fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 600, lineHeight: 1.2 },
    woMeta: { fontSize: 13.5, opacity: 0.85, marginTop: 6, fontWeight: 500 },
    woNote: { fontSize: 13, opacity: 0.92, marginTop: 10, lineHeight: 1.45, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.22)" },

    wxRow: { display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 },
    wxDay: { textAlign: "center", padding: "6px 2px", borderRadius: 10, border: "1px solid transparent", background: "transparent", cursor: "pointer", fontFamily: "inherit" },
    wxDayActive: { background: accentSoft, borderColor: accent },
    wxDetail: { marginTop: 12, paddingTop: 12, borderTop: `1px solid ${line}` },
    wxDetailScroll: { display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, scrollbarWidth: "thin" },
    wxHour: { flex: "0 0 56px", textAlign: "center", padding: "8px 4px", borderRadius: 10, background: paper },
    wxHourNow: { background: accentSoft, boxShadow: `inset 0 0 0 1.5px ${accent}` },
    wxHourTime: { fontSize: 11, color: muted, fontWeight: 600, fontVariantNumeric: "tabular-nums" },
    wxHourIcon: { fontSize: 18, margin: "3px 0" },
    wxHourTemp: { fontSize: 13, fontWeight: 700, color: ink },
    wxHourPrecip: { fontSize: 10.5, color: accent, marginTop: 3, fontVariantNumeric: "tabular-nums" },
    wxHourWind: { fontSize: 10, color: muted, marginTop: 1, fontVariantNumeric: "tabular-nums" },
    wxLegend: { fontSize: 10.5, color: muted, textAlign: "right", marginTop: 6, fontStyle: "italic" },
    wxName: { fontSize: 11, color: muted, fontWeight: 600 },
    wxIcon: { fontSize: 19, margin: "3px 0" },
    wxHi: { fontSize: 13, fontWeight: 700, color: ink },
    wxLo: { fontSize: 11.5, color: muted },
    wxPop: { fontSize: 10.5, color: accent, marginTop: 2, fontWeight: 600 },
    wxNote: { fontSize: 12, color: muted, marginTop: 12, lineHeight: 1.45, fontStyle: "italic" },

    weekRow: { display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 8 },
    weekDay: { border: `1px solid ${line}`, borderRadius: 16, padding: "12px 6px 10px", background: "#fff", cursor: "pointer", textAlign: "center", fontFamily: "inherit" },
    weekDayActive: { background: accentSoft, borderColor: accent, boxShadow: "0 8px 22px -16px rgba(47,93,158,0.7)" },
    weekName: { fontSize: 11.5, color: muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" },
    weekNum: { fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 600, margin: "3px 0 7px", color: ink },
    weekDots: { display: "flex", justifyContent: "center", gap: 3, minHeight: 8, flexWrap: "wrap" },
    weekDot: { width: 7, height: 7, borderRadius: "50%" },
    weekCount: { fontSize: 11, color: muted, marginTop: 8, fontVariantNumeric: "tabular-nums" },

    imminentBox: { background: accentSoft, border: `1px solid ${accentBorder}`, borderRadius: 14, padding: "10px 14px", marginBottom: 14, display: "flex", flexDirection: "column", gap: 6 },
    imminentRow: { display: "grid", gridTemplateColumns: "82px 10px 1fr", gap: 12, alignItems: "center" },
    imminentWhen: { fontFamily: "'Fraunces', serif", fontSize: 14, fontWeight: 700, color: accent, letterSpacing: "0.02em" },
    imminentTitle: { fontSize: 14.5, fontWeight: 600, color: ink },
    monthList: { display: "flex", flexDirection: "column", gap: 2 },
    monthItem: { display: "grid", gridTemplateColumns: "46px 10px 1fr", gap: 12, alignItems: "center", padding: "9px 4px", borderBottom: `1px solid ${line}` },
    monthDay: { fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 700, display: "block", lineHeight: 1, color: accent },
    monthMon: { fontSize: 10.5, color: muted, textTransform: "uppercase", letterSpacing: "0.05em" },
    monthDotEl: { width: 10, height: 10, borderRadius: "50%" },
    monthTitle: { fontSize: 14.5, fontWeight: 500, color: ink },

    footer: { textAlign: "center", fontSize: 12, color: muted, marginTop: 26, maxWidth: 1200, marginInline: "auto" },
  };
})();
