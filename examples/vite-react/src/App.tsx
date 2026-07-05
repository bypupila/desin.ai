import React from "react";

const heroMetrics = [
  { label: "Change bundles", value: "19", note: "latest saved today" },
  { label: "Sessions", value: "128", note: "+12% this week" },
  { label: "Selected items", value: "04", note: "overlay active" },
];

const panelMetricOrder = ["Change bundles", "Selected items", "Sessions"] as const;
const panelMetrics = panelMetricOrder
  .map((label) => heroMetrics.find((metric) => metric.label === label))
  .filter((metric): metric is (typeof heroMetrics)[number] => Boolean(metric));

const tasks = [
  { title: "Reduce CTA padding on desktop", state: "done" },
  { title: "Tighten pricing card shadow", state: "todo" },
  { title: "Keep checkout button visible on mobile", state: "todo" },
];

export default function App() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Project workspace</p>
          <h1>Northstar Commerce</h1>
        </div>
        <div className="topbar-actions">
          <button className="ghost-btn" type="button">
            Export
          </button>
          <button className="primary-btn primary-btn--publish" type="button">
            Publish
          </button>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Operational dashboard</p>
          <h2>Inspect and annotate the live product without changing the page layout.</h2>
          <div className="hero-copy__metrics" aria-label="Bundle metric values">
            {heroMetrics.map((metric) => (
              <strong key={metric.label}>{metric.value}</strong>
            ))}
          </div>
          <p className="lede">
            Use the floating inspector to select components, preview styles, scope edits by
            breakpoint, and keep project notes attached to real elements.
          </p>
        </div>
        <div className="hero-panel">
          <div className="hero-panel__header">
            <span>Active bundle</span>
            <span>desktop only</span>
          </div>
          <div className="hero-panel__body">
            <div className="hero-panel__feature">
              <strong>Button.primary</strong>
              <p>width 220px · padding 12px 18px</p>
            </div>
            <div className="hero-panel__metrics" aria-label="Bundle metrics">
              {panelMetrics.map((metric) => (
                <article className="metric-card metric-card--compact" key={metric.label}>
                  <p className={metric.label === "Selected items" ? "metric-card__label metric-card__label--accent" : "metric-card__label"}>
                    {metric.label}
                  </p>
                  <span>{metric.note}</span>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="content-grid">
        <article className="surface surface--wide">
          <div className="surface-head">
            <h3 className="surface-head__title--hero">Revenue snapshot</h3>
            <span>Updated 8 minutes ago</span>
          </div>
          <div className="chart-placeholder" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </article>

        <aside className="surface surface--narrow">
          <div className="surface-head">
            <h3 className="surface-head__title--tasks">Open tasks</h3>
            <span>Project-local</span>
          </div>
          <ul className="task-list">
            {tasks.map((task) => (
              <li key={task.title} data-state={task.state}>
                <button type="button" aria-pressed={task.state === "done"}>
                  <span className="task-state" />
                  <span>{task.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </section>

      <section className="table-surface">
        <div className="surface-head">
          <h3>Recent selections</h3>
          <span>Three elements pinned to the current page</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Element</th>
              <th>Source</th>
              <th>Scope</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Primary CTA</td>
              <td>src/components/button.tsx:14</td>
              <td>desktop</td>
              <td>previewed</td>
            </tr>
            <tr>
              <td>Pricing card</td>
              <td>src/components/pricing-card.tsx:22</td>
              <td>mobile, tablet</td>
              <td>note attached</td>
            </tr>
            <tr>
              <td>Support link</td>
              <td>src/components/footer.tsx:9</td>
              <td>global</td>
              <td>queued</td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}
