export default function DocsPage() {
  return (
    <div className="fx-shell">
      <main className="max-w-4xl mx-auto space-y-6">
        <div className="fx-card p-6 fx-reveal">
          <h1 className="fx-section-title text-3xl">Docs</h1>
          <p className="text-sm text-[#b9b0a3] mt-2">
            Getting started guides and integration notes for JSAVIOR.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 fx-reveal fx-reveal--delay-1">
          <div className="fx-card fx-card--lift p-6 space-y-3 text-sm text-[#b9b0a3]">
            <div className="fx-kicker">Overview</div>
            <p>Review setup and deployment details for local and production environments.</p>
            <ul className="space-y-1">
              <li>README.md</li>
              <li>QUICKSTART.md</li>
              <li>SETUP.md</li>
            </ul>
          </div>
          <div className="fx-card fx-card--lift p-6 space-y-3 text-sm text-[#b9b0a3]">
            <div className="fx-kicker">Contracts</div>
            <p>Reference contract addresses and interaction patterns before deploying.</p>
            <ul className="space-y-1">
              <li>contracts/README.md</li>
              <li>src/config/jsaviorAbi.json</li>
              <li>src/config/web3Config.ts</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
