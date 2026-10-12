export default function AdminLoading() {
  return (
    <main className="admin-content" aria-busy="true" aria-live="polite">
      <div className="admin-title">
        <div>
          <h1>Loading admin section</h1>
          <p>Your section is opening. This can take a moment while its data loads.</p>
        </div>
      </div>
      <section className="admin-card" role="status">
        Loading section data…
      </section>
    </main>
  );
}
