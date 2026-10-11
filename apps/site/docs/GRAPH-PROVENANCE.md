# Hero graph provenance

- Source: E0 baseline run `w1791740461-042` (query "Cl0p MOVEit extortion group", standard depth,
  engine `d384b1e`), CLI JSON pulled from `gs://voidaccess-cloud-runs/baseline/w1791740461-042/result.json`
  with va-agent (`CLOUDSDK_ACTIVE_CONFIG_NAME=voidaccess`).
- Only `content/graph-hero.json` is committed: 21 nodes, 16 edges, positions from a deterministic force layout.
  The raw JSON never left the scratchpad.
- Kept: public ransomware-group, malware and CVE names (Cl0p, LockBit, BlackCat, Black Basta, Trigona,
  AvosLocker, Play, FIN7, RansomEXX, AvNeutralizer, NetSupport RAT, seven MOVEit CVEs).
- Replaced with generated fakes: both onion addresses and the one actor handle.
- Dropped: every victim organisation; the IPs, wallets and emails (none were in the selected subgraph);
  typed edges that were clearly wrong in the run (e.g. a group "USES" FIN7 typed as malware; a
  "communicates with" edge to a one-word handle); duplicated spellings merged (CL0P and Clop to Cl0p).
- One manual correction: FIN7 was typed MALWARE_FAMILY by the engine and is shown as a group.
- Edges shown are the engine's own extracted relationships (EXPLOITS, USES, DROPS, COMMUNICATES_WITH,
  CONTROLS) plus one co-appearance. They are illustrative leads, consistent with E0 §5: the site does not
  present typed edges as victim attribution.
