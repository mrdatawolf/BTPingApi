import { useEffect, useState } from 'react';

type PingRow = {
  id: number;
  computer_name: string;
  domain: string;
  location_ip: string;
  timestamp: string;
  latency_ms: number;
  source_file: string;
  ingested_at: string;
};

type Summary = {
  total_rows: number;
  unique_computers: number;
  unique_ips: number;
};

export default function App() {
  const [rows, setRows] = useState<PingRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [computer, setComputer] = useState('');
  const [ip, setIp] = useState('');
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [rowsResponse, summaryResponse] = await Promise.all([
        fetch(`/api/pings?computer=${encodeURIComponent(computer)}&ip=${encodeURIComponent(ip)}`),
        fetch('/api/summary')
      ]);
      const rowsData = await rowsResponse.json();
      const summaryData = await summaryResponse.json();
      setRows(rowsData.rows || []);
      setSummary(summaryData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const triggerScan = async () => {
    const response = await fetch('/api/ingest/scan', { method: 'POST' });
    const data = await response.json();
    alert(JSON.stringify(data, null, 2));
    loadData();
  };

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>BTPing API</h1>
      <p>Local ping data viewer backed by PGlite and a CSV ingest flow.</p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <input value={computer} onChange={(e) => setComputer(e.target.value)} placeholder="Filter by computer" />
        <input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="Filter by IP" />
        <button onClick={() => loadData()}>Apply filters</button>
        <button onClick={triggerScan}>Run scan</button>
      </div>

      {summary && (
        <div style={{ marginBottom: 16 }}>
          <strong>Total rows:</strong> {summary.total_rows} | <strong>Computers:</strong> {summary.unique_computers} | <strong>IPs:</strong> {summary.unique_ips}
        </div>
      )}

      {loading ? <p>Loading…</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>Computer</th>
              <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>Domain</th>
              <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>IP</th>
              <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>Timestamp</th>
              <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>Latency</th>
              <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>Source file</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.computer_name}</td>
                <td>{row.domain}</td>
                <td>{row.location_ip}</td>
                <td>{row.timestamp}</td>
                <td>{row.latency_ms}</td>
                <td>{row.source_file}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
