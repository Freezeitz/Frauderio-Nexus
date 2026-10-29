import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  HashRouter,
  Routes,
  Route,
  NavLink,
  Link,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import cytoscape from "cytoscape";
import "./style.css";

let csrf = "";
async function api(path: string, method = "GET", data?: unknown) {
  const r = await fetch("/api" + path, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  let body = await r.json();
  if (!r.ok)
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : JSON.stringify(body.detail),
    );
  return body;
}
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
const money = (n: any) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(n || 0));
const date = (s: string) =>
  s
    ? new Date(s + "Z").toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
function useData(path: string) {
  return useQuery<any>({ queryKey: [path], queryFn: () => api(path) });
}
function Status({ value }: { value: string }) {
  return (
    <span className={"status " + value}>{value?.replaceAll("_", " ")}</span>
  );
}
function Message({ error }: { error: any }) {
  return error ? (
    <p className="error" role="alert">
      {error.message || String(error)}
    </p>
  ) : null;
}
function Empty({ text = "No records yet." }: { text?: string }) {
  return <div className="empty">{text}</div>;
}
function Table({
  columns,
  rows,
}: {
  columns: [string, (r: any) => React.ReactNode][];
  rows: any[];
}) {
  return rows?.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map(([n]) => (
              <th key={n}>{n}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i}>
              {columns.map(([n, fn]) => (
                <td key={n}>{fn(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty />
  );
}
function Form({
  children,
  onSubmit,
  label = "Save",
  after,
}: {
  children: React.ReactNode;
  onSubmit: (d: any) => Promise<any>;
  label?: string;
  after?: (r: any) => void;
}) {
  const [error, setError] = useState<any>();
  const [busy, setBusy] = useState(false);
  const q = useQueryClient();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const d = Object.fromEntries(new FormData(e.currentTarget));
        try {
          const r = await onSubmit(d);
          await q.invalidateQueries();
          after?.(r);
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      <Message error={error} />
      <button disabled={busy} type="submit">
        {busy ? "Saving…" : label}
      </button>
    </form>
  );
}
function Field({
  name,
  label,
  type = "text",
  value,
  required = true,
}: {
  name: string;
  label: string;
  type?: string;
  value?: any;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        step={type === "number" ? ".01" : undefined}
      />
    </label>
  );
}
function Select({
  name,
  label,
  options,
  value,
}: {
  name: string;
  label: string;
  options: any[];
  value?: any;
}) {
  return (
    <label>
      {label}
      <select name={name} defaultValue={value} required>
        {options.map((o) => (
          <option key={o.value ?? o} value={o.value ?? o}>
            {o.label ?? o}
          </option>
        ))}
      </select>
    </label>
  );
}
function Chart({ data, title }: { data: any[]; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    let plot: any;
    import("plotly.js-dist-min").then((m) => {
      plot = m.default;
      if (alive && ref.current)
        plot.newPlot(
          ref.current,
          data,
          {
            height: 260,
            margin: { t: 15, b: 40, l: 45, r: 15 },
            paper_bgcolor: "transparent",
            plot_bgcolor: "transparent",
            font: { family: "Arial", color: "#62676f", size: 11 },
            xaxis: { gridcolor: "#e4e5e1" },
            yaxis: { gridcolor: "#e4e5e1" },
            showlegend: false,
          },
          { responsive: true, displayModeBar: false },
        );
    });
    return () => {
      alive = false;
      if (plot && ref.current) plot.purge(ref.current);
    };
  }, [JSON.stringify(data)]);
  return (
    <section>
      <h3>{title}</h3>
      <div ref={ref} />
    </section>
  );
}
function Auth({ done }: { done: (v: any) => void }) {
  const [register, setRegister] = useState(false);
  return (
    <div className="auth">
      <div className="wordmark">
        FRAUDERIO<span>TRANSACTION MONITORING</span>
      </div>
      <div className="auth-form">
        <p className="eyebrow">OPERATIONS ACCESS</p>
        <h1>{register ? "Create your account" : "Sign in"}</h1>
        <p className="muted">
          {register
            ? "Register an analyst account to access the investigation workspace."
            : "Access transaction records and ongoing investigations."}
        </p>
        <Form
          label={register ? "Create account" : "Sign in"}
          onSubmit={(d) =>
            api("/auth/" + (register ? "register" : "login"), "POST", d)
          }
          after={done}
        >
          {register && <Field name="name" label="Full name" />}
          <Field name="email" label="Work email" type="email" />
          <label>
            Password
            <input
              name="password"
              type="password"
              minLength={10}
              maxLength={128}
              required
              autoComplete={register ? "new-password" : "current-password"}
            />
          </label>
          {register && (
            <p className="muted small">
              At least 10 characters. New accounts receive analyst access.
            </p>
          )}
        </Form>
        <button className="text-button" onClick={() => setRegister(!register)}>
          {register ? "Already registered? Sign in" : "Create an account"}
        </button>
        <p className="legal">
          Authorized use only · Synthetic demonstration data
        </p>
      </div>
      <footer>Frauderio Nexus / Financial investigation workspace</footer>
    </div>
  );
}
const txColumns: [string, (r: any) => React.ReactNode][] = [
  [
    "Reference",
    (r) => (
      <Link className="mono" to={"/transactions/" + r.id}>
        {r.reference}
      </Link>
    ),
  ],
  [
    "Account",
    (r) => (
      <Link to={"/accounts/" + r.account_id}>
        AC-{String(r.account_id).padStart(6, "0")}
      </Link>
    ),
  ],
  ["Date", (r) => date(r.occurred_at)],
  ["Amount", (r) => <strong className="numeric">{money(r.amount)}</strong>],
  [
    "Risk",
    (r) =>
      r.risk ? (
        <>
          <span className="mono">{r.risk.score}</span>{" "}
          <Status value={r.risk.tier} />
        </>
      ) : (
        "Unscored"
      ),
  ],
  ["Status", (r) => r.status],
];
function RingCandidates() {
  const d = useData("/fraud-rings");
  return (
    <section>
      <h2>Shared-device communities</h2>
      <p className="muted">
        Candidate associations for investigation. Shared infrastructure alone
        does not establish fraud.
      </p>
      <Message error={d.error} />
      <Table
        rows={d.data || []}
        columns={[
          [
            "Community",
            (r) => <Link to={"/network/" + r.id}>Inspect {r.id}</Link>,
          ],
          ["Accounts", (r) => r.accounts],
          ["Shared devices", (r) => r.shared_devices],
          ["Density", (r) => r.density.toFixed(2)],
          ["Highest recorded score", (r) => r.max_risk_score],
        ]}
      />
    </section>
  );
}
function Catalogue() {
  return (
    <div className="two-col">
      <section>
        <h2>Register device</h2>
        <Form onSubmit={(v) => api("/devices", "POST", v)}>
          <Field name="reference" label="Unique device reference" />
          <Select
            name="kind"
            label="Device type"
            options={["mobile", "desktop", "terminal"]}
          />
        </Form>
      </section>
      <section>
        <h2>Register merchant</h2>
        <Form onSubmit={(v) => api("/merchants", "POST", v)}>
          <Field name="name" label="Merchant name" />
          <Field name="category" label="Category" />
          <Field
            name="risk"
            label="Reference risk (0–1)"
            type="number"
            value="0.1"
          />
        </Form>
      </section>
    </div>
  );
}
function Overview() {
  const o = useData("/overview");
  const t = useData("/transactions?limit=8");
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">MONITORING</p>
          <h1>Operations overview</h1>
          <p className="muted">
            Account activity, risk assessments and investigations.
          </p>
        </div>
        <Link className="button" to="/submit">
          Record transaction
        </Link>
      </header>
      <Message error={o.error} />
      {o.data && (
        <>
          <div className="summary">
            {[
              ["Transactions", o.data.transactions],
              ["Open alerts", o.data.alerts],
              ["Active cases", o.data.cases],
              ["Amount under review", money(o.data.amount_under_review)],
            ].map(([n, v]) => (
              <div key={n}>
                <span>{n}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
          <Chart
            title="Risk distribution"
            data={[
              {
                type: "bar",
                x: o.data.risk_distribution.map((r: any) => r.tier),
                y: o.data.risk_distribution.map((r: any) => r.count),
                marker: { color: "#164e63" },
              },
            ]}
          />
        </>
      )}
      <div className="section-title">
        <h2>Recent transactions</h2>
        <Link to="/transactions">View ledger →</Link>
      </div>
      <Table columns={txColumns} rows={t.data || []} />
      <p className="footnote">
        Values represent recorded synthetic activity. Suggested actions do not
        move or block funds.
      </p>
    </>
  );
}
function Transactions() {
  const [q, setQ] = useState("");
  const [tier, setTier] = useState("");
  const [page, setPage] = useState(0);
  const d = useData(
    `/transactions?q=${encodeURIComponent(q)}&tier=${tier}&offset=${page * 100}`,
  );
  return (
    <>
      <header>
        <h1>Transaction ledger</h1>
        <Link className="button" to="/submit">
          Record transaction
        </Link>
      </header>
      <div className="filters">
        <input
          aria-label="Search reference"
          placeholder="Search transaction reference"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
        <select
          aria-label="Filter risk"
          value={tier}
          onChange={(e) => {
            setTier(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All risk levels</option>
          {["low", "medium", "high", "critical"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <Message error={d.error} />
      <Table columns={txColumns} rows={d.data || []} />
      <div className="pager">
        <button
          className="secondary"
          disabled={!page}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </button>
        <span>Page {page + 1}</span>
        <button
          className="secondary"
          disabled={d.data?.length < 100}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </>
  );
}
function Submit() {
  const a = useData("/accounts");
  const c = useData("/catalogue");
  const nav = useNavigate();
  return (
    <>
      <header>
        <h1>Record transaction</h1>
      </header>
      <p className="muted">
        Save the financial record and generate a versioned risk assessment.
      </p>
      <Form
        label="Record and assess"
        onSubmit={(d) =>
          api("/transactions", "POST", {
            ...d,
            account_id: +d.account_id,
            device_id: +d.device_id,
            merchant_id: +d.merchant_id,
            receiver_id: d.receiver_id ? +d.receiver_id : null,
          })
        }
        after={(r) => nav("/transactions/" + r.transaction.id)}
      >
        <div className="form-grid">
          <Field
            name="reference"
            label="Unique transaction reference"
            value={"TX-" + Date.now()}
          />
          <Select
            name="account_id"
            label="Account"
            options={(a.data || []).map((r: any) => ({
              value: r.id,
              label: r.reference + " · " + r.name,
            }))}
          />
          <Field name="amount" label="Amount (INR)" type="number" />
          <Field name="city" label="Transaction city" value="Bengaluru" />
          <Select
            name="device_id"
            label="Device"
            options={(c.data?.devices || []).map((r: any) => ({
              value: r.id,
              label: r.reference,
            }))}
          />
          <Select
            name="merchant_id"
            label="Merchant"
            options={(c.data?.merchants || []).map((r: any) => ({
              value: r.id,
              label: r.name,
            }))}
          />
          <Field
            name="receiver_id"
            label="Receiving account ID (optional)"
            type="number"
            required={false}
          />
        </div>
      </Form>
    </>
  );
}
function TransactionDetail() {
  const { id } = useParams();
  const d = useData("/transactions/" + id);
  const nav = useNavigate();
  const [scenario, setScenario] = useState<any>();
  if (!d.data) return <Message error={d.error} />;
  const { transaction: t, prediction: p, factors } = d.data;
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">TRANSACTION RECORD</p>
          <h1 className="mono">{t.reference}</h1>
        </div>
        <strong className="large-amount">{money(t.amount)}</strong>
      </header>
      <div className="record-meta">
        <Link to={"/accounts/" + t.account_id}>Account {t.account_id}</Link>
        <span>{date(t.occurred_at)}</span>
        <span>{t.city}</span>
        <span>{t.channel}</span>
      </div>
      {p && (
        <>
          <div className="assessment">
            <div>
              <p className="eyebrow">COMBINED RISK</p>
              <strong className="score">
                {p.score}
                <small> / 1000</small>
              </strong>
              <Status value={p.tier} />
              <p>Recommended action: {p.action}</p>
            </div>
            <div className="component-list">
              {Object.entries(p.components).map(([k, v]) => (
                <div key={k}>
                  <span>{k.replaceAll("_", " ")}</span>
                  <progress value={Number(v)} max={1} />
                  <span className="mono">{(Number(v) * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
          <p className="footnote">
            Behaviour is an anomaly percentile, not a fraud probability. Other
            model scores are combined and calibrated by the ensemble.
          </p>
          <h2>Decision factors</h2>
          <Table
            rows={factors}
            columns={[
              ["Factor", (r) => r.message],
              ["Contribution", (r) => Number(r.contribution).toFixed(3)],
            ]}
          />
          <p className="footnote">
            TreeSHAP contributions explain the transaction model in log-odds,
            not the final combined score.
          </p>
          <div className="two-col">
            <section>
              <h2>Open investigation</h2>
              <Form
                label="Create case"
                onSubmit={(v) =>
                  api("/cases", "POST", {
                    ...v,
                    transaction_id: +id!,
                    account_id: t.account_id,
                  })
                }
                after={(r) => nav("/cases/" + r.id)}
              >
                <Field
                  name="title"
                  label="Case title"
                  value={"Review " + t.reference}
                />
              </Form>
              <h2>Analyst outcome</h2>
              <Form
                onSubmit={(v) =>
                  api("/transactions/" + id + "/feedback", "POST", v)
                }
              >
                <Select
                  name="outcome"
                  label="Outcome"
                  options={["uncertain", "legitimate", "fraud"]}
                />
                <Field name="reason" label="Reason" />
              </Form>
            </section>
            <section>
              <h2>Scenario comparison</h2>
              <Form
                label="Recalculate scenario"
                onSubmit={(v) =>
                  api("/transactions/" + id + "/scenario", "POST", {
                    amount: v.amount,
                    trusted_device: v.trusted_device === "yes",
                  })
                }
                after={setScenario}
              >
                <Field
                  name="amount"
                  label="Hypothetical amount"
                  type="number"
                  value={t.amount}
                />
                <Select
                  name="trusted_device"
                  label="Assume trusted device"
                  options={["no", "yes"]}
                />
              </Form>
              {scenario && (
                <p className="scenario">
                  Original {scenario.original_score} → scenario{" "}
                  {scenario.scenario.score}. No saved records changed.
                </p>
              )}
            </section>
          </div>
          <h2>Recorded feedback</h2>
          <Table
            rows={d.data.feedback}
            columns={[
              ["Outcome", (r) => r.outcome],
              ["Reason", (r) => r.reason],
              ["Recorded", (r) => date(r.created_at)],
            ]}
          />
        </>
      )}
    </>
  );
}
function Accounts() {
  const d = useData("/accounts");
  const [show, setShow] = useState(false);
  const nav = useNavigate();
  return (
    <>
      <header>
        <h1>Customer accounts</h1>
        <button onClick={() => setShow(!show)}>Create customer account</button>
      </header>
      {show && (
        <section className="editor">
          <Form
            onSubmit={(v) => api("/accounts", "POST", v)}
            after={(r) => nav("/accounts/" + r.id)}
          >
            <div className="form-grid">
              <Field name="name" label="Account holder" />
              <Field name="city" label="Home city" />
              <Field
                name="usual_amount"
                label="Usual amount (INR)"
                type="number"
                value="2000"
              />
            </div>
          </Form>
        </section>
      )}
      <p className="muted">
        Customer financial records are separate from staff sign-in accounts.
      </p>
      <Message error={d.error} />
      <Table
        rows={d.data || []}
        columns={[
          [
            "Account",
            (r) => <Link to={"/accounts/" + r.id}>{r.reference}</Link>,
          ],
          ["Holder", (r) => r.name],
          ["City", (r) => r.city],
          ["Opened", (r) => date(r.opened_at)],
          ["Status", (r) => <Status value={r.status} />],
        ]}
      />
    </>
  );
}
function AccountDetail() {
  const { id } = useParams();
  const d = useData("/accounts/" + id);
  if (!d.data) return <Message error={d.error} />;
  const { account: a, transactions: tx, events } = d.data;
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">ACCOUNT RECORD / {a.reference}</p>
          <h1>{a.name}</h1>
        </div>
        <Link className="button secondary" to={"/network/" + id}>
          Inspect connections
        </Link>
      </header>
      <div className="record-meta">
        <span>{a.city}</span>
        <span>Opened {date(a.opened_at)}</span>
        <Status value={a.status} />
      </div>
      <Chart
        title="Recent transaction amounts"
        data={[
          {
            type: "scatter",
            mode: "lines+markers",
            x: [...tx].reverse().map((t: any) => t.occurred_at),
            y: [...tx].reverse().map((t: any) => Number(t.amount)),
            line: { color: "#164e63", width: 1.5 },
            marker: { size: 4 },
          },
        ]}
      />
      <h2>Transaction history</h2>
      <Table columns={txColumns} rows={tx} />
      <Link to="/transactions">Search the full ledger</Link>
      <div className="two-col">
        <section>
          <h2>Security event timeline</h2>
          <Table
            rows={events}
            columns={[
              ["Event", (r) => r.kind.replaceAll("_", " ")],
              ["Time", (r) => date(r.occurred_at)],
            ]}
          />
        </section>
        <section>
          <h2>Record security event</h2>
          <Form
            onSubmit={(v) => api("/events", "POST", { ...v, account_id: +id! })}
          >
            <Select
              name="kind"
              label="Event"
              options={[
                "login",
                "password_reset",
                "otp_failed",
                "beneficiary_added",
                "device_change",
              ]}
            />
          </Form>
          <h2>Device history</h2>
          <Table
            rows={d.data.devices}
            columns={[
              ["Device", (r) => "DEV-" + r.device_id],
              ["Trust", (r) => (r.trusted ? "Trusted" : "Unverified")],
            ]}
          />
        </section>
      </div>
    </>
  );
}
function Network() {
  const { id = "1" } = useParams();
  const nav = useNavigate();
  const d = useData("/network/" + id);
  const ref = useRef<HTMLDivElement>(null);

  const [selected, setSelected] = useState("");
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    if (!d.data || !ref.current) return;

    const centre = `A${id}`;
    const allNodes = d.data.nodes as any[];
    const allEdges = d.data.edges as any[];

    /*
     * Create an adjacency list from the network edges.
     * This lets us find the nodes closest to the account
     * currently being investigated.
     */
    const neighbours = new Map<string, string[]>();

    allEdges.forEach((edge) => {
      const { source, target } = edge.data;

      neighbours.set(source, [
        ...(neighbours.get(source) || []),
        target,
      ]);

      neighbours.set(target, [
        ...(neighbours.get(target) || []),
        source,
      ]);
    });

    /*
     * Show the investigated account and up to 35 nearby
     * nodes. This prevents a large network from becoming
     * unreadable.
     */
    const selectedIds = new Set<string>([centre]);
    const queue = [centre];

    while (queue.length > 0 && selectedIds.size < 36) {
      const current = queue.shift()!;

      for (const next of neighbours.get(current) || []) {
        if (selectedIds.size >= 36) break;

        if (!selectedIds.has(next)) {
          selectedIds.add(next);
          queue.push(next);
        }
      }
    }

    const visibleNodes = allNodes.filter((node) =>
      selectedIds.has(node.data.id),
    );

    const visibleEdges = allEdges.filter(
      (edge) =>
        selectedIds.has(edge.data.source) &&
        selectedIds.has(edge.data.target),
    );

    setVisibleCount(visibleNodes.length);

    const cy = cytoscape({
      container: ref.current,

      elements: [...visibleNodes, ...visibleEdges],

      layout: {
        name: "cose",
        animate: false,
        fit: true,
        padding: 55,
        nodeRepulsion: () => 180000,
        idealEdgeLength: () => 115,
        edgeElasticity: () => 80,
        gravity: 0.18,
        numIter: 1200,
      },

      style: [
        /*
         * Default account node
         */
        {
          selector: "node",
          style: {
            "background-color": "#b9c3c1",
            label: "data(label)",
            "font-size": 11,
            "font-family": "IBM Plex Sans, Arial, sans-serif",
            "font-weight": 500,
            color: "#414950",
            width: 25,
            height: 25,

            /*
             * Labels remain hidden until the user hovers
             * over or selects a node.
             */
            "text-opacity": 0,
            "text-background-color": "#fafbf8",
            "text-background-opacity": 0.94,
            "text-background-padding": "4px",
            "text-margin-y": -20,
            "text-wrap": "none",
          },
        },

        /*
         * Device nodes
         */
        {
          selector: 'node[kind="device"]',
          style: {
            shape: "round-rectangle",
            "background-color": "#d0b889",
            width: 27,
            height: 27,
          },
        },

        /*
         * Merchant nodes
         */
        {
          selector: 'node[kind="merchant"]',
          style: {
            shape: "diamond",
            "background-color": "#8fa6a0",
            width: 27,
            height: 27,
          },
        },

        /*
         * Account currently being investigated
         */
        {
          selector: `node[id="A${id}"]`,
          style: {
            "background-color": "#164e63",
            width: 42,
            height: 42,
            color: "#123f50",
            "text-opacity": 1,
            "font-size": 12,
          },
        },

        /*
         * Hovered or selected nodes
         */
        {
          selector: "node.reveal-label, node:selected",
          style: {
            "text-opacity": 1,
            "border-width": 2,
            "border-color": "#164e63",
          },
        },

        /*
         * Default relationship lines
         */
        {
          selector: "edge",
          style: {
            width: 1,
            "line-color": "#d4d8d3",
            "curve-style": "bezier",
            opacity: 0.8,
          },
        },

        /*
         * Relationship lines connected to the hovered node
         */
        {
          selector: "edge.highlighted",
          style: {
            width: 2,
            "line-color": "#72919a",
            opacity: 1,
          },
        },
      ],
    });

    /*
     * Reveal a node label and its relationships
     * when the mouse is over it.
     */
    cy.on("mouseover", "node", (event) => {
      const node = event.target;

      node.addClass("reveal-label");
      node.connectedEdges().addClass("highlighted");
    });

    /*
     * Hide the label after the mouse leaves unless
     * the node is currently selected.
     */
    cy.on("mouseout", "node", (event) => {
      const node = event.target;

      if (!node.selected()) {
        node.removeClass("reveal-label");
      }

      node.connectedEdges().removeClass("highlighted");
    });

    /*
     * Select a node when it is clicked.
     */
    cy.on("tap", "node", (event) => {
      const node = event.target;

      setSelected(node.id());

      cy.nodes().removeClass("reveal-label");
      node.addClass("reveal-label");
    });

    /*
     * Clear the selection when the empty background
     * is clicked.
     */
    cy.on("tap", (event) => {
      if (event.target === cy) {
        setSelected("");
        cy.nodes().removeClass("reveal-label");
      }
    });

    return () => {
      cy.destroy();
    };
  }, [d.data, id]);

  return (
    <>
      <header>
        <h1>Network investigation</h1>
      </header>

      <Form
        label="Inspect account"
        onSubmit={async (values) => {
          nav("/network/" + values.id);
        }}
      >
        <div className="filters">
          <Field
            name="id"
            label="Account ID"
            type="number"
            value={id}
          />
        </div>
      </Form>

      <Message error={d.error} />

      <div ref={ref} className="network" />

      {d.data && (
        <p className="muted small">
          Showing {visibleCount} focused nodes from{" "}
          {d.data.nodes.length} nodes in the two-hop network.
          Hover over a node to reveal its label. Drag nodes or
          scroll inside the graph to explore.
        </p>
      )}

      {selected && (
        <p>
          Selected: {selected}{" "}

          {selected.startsWith("A") && (
            <Link to={"/accounts/" + selected.slice(1)}>
              Open account record →
            </Link>
          )}
        </p>
      )}

      <p className="footnote">
        {d.data?.scope} Teal: investigated account. Grey:
        linked account. Gold square: device. Green diamond:
        merchant.
      </p>
    </>
  );
}
function Alerts() {
  const d = useData("/alerts");
  const q = useQueryClient();
  const [error, setError] = useState<any>();
  return (
    <>
      <header>
        <h1>Alert queue</h1>
      </header>
      <Message error={error || d.error} />
      <Table
        rows={d.data || []}
        columns={[
          ["Alert", (r) => "AL-" + r.id],
          [
            "Transaction",
            (r) => (
              <Link to={"/transactions/" + r.transaction_id}>
                View transaction {r.transaction_id}
              </Link>
            ),
          ],
          [
            "Account",
            (r) => <Link to={"/accounts/" + r.account_id}>{r.account_id}</Link>,
          ],
          ["Opened", (r) => date(r.created_at)],
          [
            "Status",
            (r) => (
              <select
                aria-label={"Alert " + r.id + " status"}
                value={r.status}
                onChange={async (e) => {
                  try {
                    await api("/alerts/" + r.id, "PATCH", {
                      status: e.target.value,
                    });
                    q.invalidateQueries();
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                {[
                  "new",
                  "under_review",
                  "escalated",
                  "resolved",
                  "dismissed",
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            ),
          ],
        ]}
      />
    </>
  );
}
function Cases() {
  const d = useData("/cases");
  const nav = useNavigate();
  return (
    <>
      <header>
        <h1>Investigations</h1>
      </header>
      <Form
        label="Open case"
        onSubmit={(v) => api("/cases", "POST", v)}
        after={(r) => nav("/cases/" + r.id)}
      >
        <Field name="title" label="New case title" />
      </Form>
      <Table
        rows={d.data || []}
        columns={[
          ["Case", (r) => <Link to={"/cases/" + r.id}>CASE-{r.id}</Link>],
          ["Title", (r) => r.title],
          ["Status", (r) => <Status value={r.status} />],
          ["Assigned to", (r) => r.assigned_to],
          ["Opened", (r) => date(r.created_at)],
        ]}
      />
    </>
  );
}
function CaseDetail({ user }: { user: any }) {
  const { id } = useParams();
  const d = useData("/cases/" + id);
  if (!d.data) return <Message error={d.error} />;
  const c = d.data.case;
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">CASE-{id}</p>
          <h1>{c.title}</h1>
        </div>
        <Status value={c.status} />
      </header>
      <p>
        Linked transactions:{" "}
        {d.data.transactions.map((i: number) => (
          <Link key={i} to={"/transactions/" + i}>
            {" "}
            {i}{" "}
          </Link>
        ))}
      </p>
      <p>
        Linked accounts:{" "}
        {d.data.accounts.map((i: number) => (
          <Link key={i} to={"/accounts/" + i}>
            {" "}
            {i}{" "}
          </Link>
        ))}
      </p>
      <h2>Investigation notes</h2>
      {d.data.notes.map((n: any) => (
        <article className="note" key={n.id}>
          <p>{n.text}</p>
          <span className="muted">
            Staff {n.author_id} · {date(n.created_at)}
          </span>
        </article>
      ))}
      <Form
        label="Add note"
        onSubmit={(v) => api("/cases/" + id + "/notes", "POST", v)}
      >
        <label>
          Note
          <textarea name="text" required maxLength={3000} />
        </label>
      </Form>
      {user.role !== "analyst" && (
        <>
          <h2>Case disposition</h2>
          <Form onSubmit={(v) => api("/cases/" + id, "PATCH", v)}>
            <Select
              name="status"
              label="Status"
              options={["open", "under_review", "escalated", "closed"]}
              value={c.status}
            />
            <Field
              name="resolution"
              label="Resolution"
              required={false}
              value={c.resolution || ""}
            />
          </Form>
        </>
      )}
    </>
  );
}
function Models() {
  const d = useData("/models");
  if (!d.data) return <Message error={d.error} />;
  const m = d.data.metrics;
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">VALIDATION / {d.data.version}</p>
          <h1>Model analysis</h1>
        </div>
      </header>
      <p className="muted">
        {m.dataset}. Held-out evaluation: {m.test_rows.toLocaleString()} rows.
        Positive rate: {(m.positive_rate * 100).toFixed(2)}%.
      </p>
      <div className="summary">
        {[
          ["Average precision", m.average_precision],
          ["ROC AUC", m.roc_auc],
          ["Brier score", m.brier_score],
        ].map(([n, v]) => (
          <div key={n}>
            <span>{n}</span>
            <strong>{Number(v).toFixed(3)}</strong>
          </div>
        ))}
      </div>
      <div className="two-col">
        <Chart
          title="Precision–recall curve"
          data={[
            {
              x: m.curves.recall,
              y: m.curves.precision,
              type: "scatter",
              line: { color: "#164e63" },
            },
          ]}
        />
        <Chart
          title="Calibration"
          data={[
            {
              x: m.curves.calibration_predicted,
              y: m.curves.calibration_observed,
              type: "scatter",
              mode: "lines+markers",
              line: { color: "#164e63" },
            },
            {
              x: [0, 1],
              y: [0, 1],
              type: "scatter",
              line: { color: "#aaa", dash: "dot" },
            },
          ]}
        />
      </div>
      <h2>Model comparison</h2>
      <Table
        rows={[
          {
            name: "Transaction classifier",
            ap: m.transaction_average_precision,
          },
          { name: "Network classifier", ap: m.network_average_precision },
          { name: "Calibrated ensemble", ap: m.average_precision },
        ]}
        columns={[
          ["Model", (r) => r.name],
          ["Average precision", (r) => r.ap.toFixed(4)],
        ]}
      />
      <h2>Confusion matrix at probability 0.5</h2>
      <Table
        rows={m.confusion_matrix_at_0_5.map((r: number[], i: number) => ({
          label: i ? "Actual fraud" : "Actual legitimate",
          negative: r[0],
          positive: r[1],
        }))}
        columns={[
          ["Actual class", (r) => r.label],
          ["Predicted legitimate", (r) => r.negative],
          ["Predicted fraud", (r) => r.positive],
        ]}
      />
      <p className="footnote">
        Training uses independent base-fit, ensemble-fit, calibration and test
        partitions. Simulation results do not establish operational performance.
      </p>
    </>
  );
}
function System({ user }: { user: any }) {
  const d = useData("/monitoring");
  const t = useData("/thresholds");
  return (
    <>
      <header>
        <h1>System monitoring</h1>
      </header>
      <p className="muted">
        Distribution comparison against the synthetic training reference. Drift
        does not itself establish reduced detection accuracy.
      </p>
      {user.role !== "analyst" && (
        <Form
          label="Measure feature drift"
          onSubmit={() => api("/monitoring/run", "POST", {})}
        >
          <span />
        </Form>
      )}
      <Table
        rows={d.data || []}
        columns={[
          ["Feature", (r) => r.feature],
          ["KS statistic", (r) => r.statistic.toFixed(3)],
          ["P value", (r) => r.p_value.toExponential(2)],
          ["Samples", (r) => r.sample_size],
          ["Measured", (r) => date(r.created_at)],
        ]}
      />
      {user.role === "admin" && t.data && (
        <>
          <h2>Risk thresholds</h2>
          <p className="muted">
            Changes apply to new assessments. Historical decisions retain their
            original tier.
          </p>
          <Form onSubmit={(v) => api("/thresholds", "POST", v)}>
            <div className="form-grid">
              {["low", "medium", "high"].map((k) => (
                <Field
                  key={k}
                  name={k}
                  label={k + " maximum"}
                  type="number"
                  value={t.data[k]}
                />
              ))}
            </div>
          </Form>
        </>
      )}
    </>
  );
}
function Users() {
  const d = useData("/users");
  const s = useData("/sessions");
  const q = useQueryClient();
  const [error, setError] = useState<any>();
  return (
    <>
      <header>
        <h1>User administration</h1>
      </header>
      <p className="muted">
        Staff records and session history stored in the database. Passwords and
        session secrets are never displayed.
      </p>
      <Message error={error || d.error} />
      <Table
        rows={d.data || []}
        columns={[
          ["Name", (r) => r.name],
          ["Email", (r) => r.email],
          [
            "Role",
            (r) => (
              <select
                value={r.role}
                aria-label={"Role for " + r.email}
                onChange={async (e) => {
                  try {
                    await api("/users/" + r.id, "PATCH", {
                      role: e.target.value,
                      active: r.active,
                    });
                    q.invalidateQueries();
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                {["analyst", "supervisor", "admin"].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            ),
          ],
          [
            "Status",
            (r) => (
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await api("/users/" + r.id, "PATCH", {
                      role: r.role,
                      active: !r.active,
                    });
                    q.invalidateQueries();
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                {r.active ? "Active — disable" : "Disabled — enable"}
              </button>
            ),
          ],
          ["Last sign in", (r) => date(r.last_login_at)],
        ]}
      />
      <h2>Session records</h2>
      <Table
        rows={s.data || []}
        columns={[
          ["Session", (r) => r.id],
          ["User", (r) => r.user_id],
          ["Created", (r) => date(r.created_at)],
          ["Expires", (r) => date(r.expires_at)],
          ["Signed out", (r) => date(r.revoked_at)],
        ]}
      />
    </>
  );
}
function Audit() {
  const d = useData("/audit");
  return (
    <>
      <header>
        <h1>Audit history</h1>
      </header>
      <Message error={d.error} />
      <Table
        rows={d.data || []}
        columns={[
          ["Time", (r) => date(r.created_at)],
          ["User", (r) => r.user_id],
          ["Action", (r) => r.action.replaceAll("_", " ")],
          ["Record", (r) => r.entity],
          ["Details", (r) => <code>{JSON.stringify(r.detail)}</code>],
        ]}
      />
    </>
  );
}
function App() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>();
  useEffect(() => {
    api("/auth/me")
      .then((r) => {
        csrf = r.csrf;
        setSession(r);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  if (loading) return <div className="loading">Opening workspace…</div>;
  if (!session)
    return (
      <Auth
        done={(r) => {
          csrf = r.csrf;
          setSession(r);
          client.clear();
        }}
      />
    );
  const u = session.user;
  const links = [
    ["/", "Overview"],
    ["/transactions", "Transactions"],
    ["/alerts", "Alerts"],
    ["/cases", "Investigations"],
    ["/network/1", "Networks"],
    ["/accounts", "Accounts"],
    ["/models", "Models"],
    ["/system", "System"],
    ...(u.role === "admin" ? [["/users", "Users"]] : []),
    ...(u.role !== "analyst" ? [["/audit", "Audit history"]] : []),
  ];
  return (
    <div className="shell">
      <aside>
        <Link to="/" className="wordmark">
          FRAUDERIO<span>TRANSACTION MONITORING</span>
        </Link>
        <nav>
          {links.map(([to, label]) => (
            <NavLink end={to === "/"} key={to} to={to}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="identity">
          <strong>{u.name}</strong>
          <span>{u.role}</span>
          <button
            className="text-button"
            onClick={async () => {
              try {
                await api("/auth/logout", "POST", {});
                csrf = "";
                setSession(null);
                client.clear();
              } catch (e) {
                setError(e);
              }
            }}
          >
            Sign out
          </button>
          <Message error={error} />
        </div>
      </aside>
      <div className="workspace">
        <div className="topline">
          <span>NEXUS / OPERATIONS</span>
          <span className="mono">INR · SYNTHETIC DATA</span>
        </div>
        <main>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/transactions/:id" element={<TransactionDetail />} />
            <Route path="/submit" element={<Submit />} />
            <Route
              path="/accounts"
              element={
                <>
                  <Accounts />
                  <Catalogue />
                </>
              }
            />
            <Route path="/accounts/:id" element={<AccountDetail />} />
            <Route
              path="/network/:id"
              element={
                <>
                  <Network />
                  <RingCandidates />
                </>
              }
            />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/cases" element={<Cases />} />
            <Route path="/cases/:id" element={<CaseDetail user={u} />} />
            <Route path="/models" element={<Models />} />
            <Route path="/system" element={<System user={u} />} />
            <Route path="/users" element={<Users />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="*" element={<Empty text="Page not found" />} />
          </Routes>
        </main>
        <footer>
          Frauderio Nexus · Investigation workspace · All times displayed
          locally
        </footer>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <HashRouter>
      <App />
    </HashRouter>
  </QueryClientProvider>,
);
