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

// API helpers

let csrf = "";

async function api(
  path: string,
  method = "GET",
  data?: unknown,
) {
  const response = await fetch("/api" + path, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : JSON.stringify(body.detail),
    );
  }

  return body;
}

const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const money = (value: any) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const date = (value: string) =>
  value
    ? new Date(value + "Z").toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

function useData(path: string) {
  return useQuery<any>({
    queryKey: [path],
    queryFn: () => api(path),
  });
}

// Shared components

function Status({ value }: { value: string }) {
  return (
    <span className={"status " + value}>
      {value?.replaceAll("_", " ")}
    </span>
  );
}

function Message({ error }: { error: any }) {
  return error ? (
    <p className="error" role="alert">
      {error.message || String(error)}
    </p>
  ) : null;
}

function Empty({
  text = "No records yet.",
}: {
  text?: string;
}) {
  return <div className="empty">{text}</div>;
}

function Table({
  columns,
  rows,
}: {
  columns: [string, (row: any) => React.ReactNode][];
  rows: any[];
}) {
  if (!rows?.length) return <Empty />;

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map(([name]) => (
              <th key={name}>{name}</th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? index}>
              {columns.map(([name, render]) => (
                <td key={name}>{render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Form({
  children,
  onSubmit,
  label = "Save",
  after,
}: {
  children: React.ReactNode;
  onSubmit: (values: any) => Promise<any>;
  label?: string;
  after?: (result: any) => void;
}) {
  const [error, setError] = useState<any>();
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);

        const values = Object.fromEntries(
          new FormData(event.currentTarget),
        );

        try {
          const result = await onSubmit(values);
          await queryClient.invalidateQueries();
          after?.(result);
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
        {options.map((option) => (
          <option
            key={option.value ?? option}
            value={option.value ?? option}
          >
            {option.label ?? option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Chart({
  data,
  title,
}: {
  data: any[];
  title: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    let plot: any;

    import("plotly.js-dist-min").then((module) => {
      plot = module.default;

      if (alive && ref.current) {
        plot.newPlot(
          ref.current,
          data,
          {
            height: 260,
            margin: { t: 15, b: 40, l: 45, r: 15 },
            paper_bgcolor: "transparent",
            plot_bgcolor: "transparent",
            font: {
              family: "Arial",
              color: "#62676f",
              size: 11,
            },
            xaxis: { gridcolor: "#e4e5e1" },
            yaxis: { gridcolor: "#e4e5e1" },
            showlegend: false,
          },
          {
            responsive: true,
            displayModeBar: false,
          },
        );
      }
    });

    return () => {
      alive = false;

      if (plot && ref.current) {
        plot.purge(ref.current);
      }
    };
  }, [JSON.stringify(data)]);

  return (
    <section>
      <h3>{title}</h3>
      <div ref={ref} />
    </section>
  );
}

// Sign in and registration

function Auth({ done }: { done: (result: any) => void }) {
  const [register, setRegister] = useState(false);

  return (
    <div className="auth">
      <div className="wordmark">
        FRAUDERIO
        <span>TRANSACTION MONITORING</span>
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
          onSubmit={(values) =>
            api(
              "/auth/" + (register ? "register" : "login"),
              "POST",
              values,
            )
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
              autoComplete={
                register ? "new-password" : "current-password"
              }
            />
          </label>

          {register && (
            <p className="muted small">
              At least 10 characters. New accounts receive analyst access.
            </p>
          )}
        </Form>

        <button
          className="text-button"
          onClick={() => setRegister(!register)}
        >
          {register
            ? "Already registered? Sign in"
            : "Create an account"}
        </button>

        <p className="legal">
          Authorized use only · Financial investigation workspace
        </p>
      </div>

      <footer>
        Frauderio Nexus / Financial investigation workspace
      </footer>
    </div>
  );
}

// Transaction table columns

const txColumns: [string, (row: any) => React.ReactNode][] = [
  [
    "Reference",
    (row) => (
      <Link className="mono" to={"/transactions/" + row.id}>
        {row.reference}
      </Link>
    ),
  ],
  [
    "Account",
    (row) => (
      <Link to={"/accounts/" + row.account_id}>
        {row.account_number || row.account_id}
      </Link>
    ),
  ],
  ["Date", (row) => date(row.occurred_at)],
  [
    "Amount",
    (row) => (
      <strong className="numeric">{money(row.amount)}</strong>
    ),
  ],
  [
    "Risk",
    (row) =>
      row.risk ? (
        <>
          <span className="mono">{row.risk.score}</span>{" "}
          <Status value={row.risk.tier} />
        </>
      ) : (
        "Unscored"
      ),
  ],
  ["Status", (row) => row.status],
];

// Overview

function Overview() {
  const overview = useData("/overview");
  const transactions = useData("/transactions?limit=8");

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

      <Message error={overview.error || transactions.error} />

      {overview.data && (
        <>
          <div className="summary">
            {[
              ["Transactions", overview.data.transactions],
              ["Open alerts", overview.data.alerts],
              ["Active cases", overview.data.cases],
              [
                "Amount under review",
                money(overview.data.amount_under_review),
              ],
            ].map(([name, value]) => (
              <div key={name}>
                <span>{name}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>

          <Chart
            title="Risk distribution"
            data={[
              {
                type: "bar",
                x: overview.data.risk_distribution.map(
                  (row: any) => row.tier,
                ),
                y: overview.data.risk_distribution.map(
                  (row: any) => row.count,
                ),
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

      <Table
        columns={txColumns}
        rows={transactions.data || []}
      />

      <p className="footnote">
        Values reflect saved transactions. Suggested actions do not
        move or block funds.
      </p>
    </>
  );
}

// Transaction ledger

function Transactions() {
  const [search, setSearch] = useState("");
  const [tier, setTier] = useState("");
  const [page, setPage] = useState(0);

  const data = useData(
    `/transactions?q=${encodeURIComponent(search)}&tier=${tier}&offset=${page * 100}`,
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
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
        />

        <select
          aria-label="Filter risk"
          value={tier}
          onChange={(event) => {
            setTier(event.target.value);
            setPage(0);
          }}
        >
          <option value="">All risk levels</option>

          {["low", "medium", "high", "critical"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </div>

      <Message error={data.error} />

      <Table columns={txColumns} rows={data.data || []} />

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
          disabled={!data.data || data.data.length < 100}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </>
  );
}

// Record a transaction

function Submit() {
  const accounts = useData("/accounts");
  const catalogue = useData("/catalogue");
  const navigate = useNavigate();

  const [accountMode, setAccountMode] = useState("existing");
  const [merchantMode, setMerchantMode] = useState("existing");
  const [deviceMode, setDeviceMode] = useState("existing");
  const [reference] = useState(() => "TX-" + Date.now());

  const newAccount =
    accountMode === "new" || accounts.data?.length === 0;

  const newMerchant =
    merchantMode === "new" ||
    catalogue.data?.merchants.length === 0;

  const newDevice =
    deviceMode === "new" ||
    catalogue.data?.devices.length === 0;

  if (!accounts.data || !catalogue.data) {
    return (
      <>
        <Message error={accounts.error || catalogue.error} />
        <p>Loading saved accounts and merchants…</p>
      </>
    );
  }

  return (
    <>
      <header>
        <h1>Record transaction</h1>
      </header>

      <p className="muted">
        Choose saved details or add new ones. New accounts and merchants
        are saved with this transaction and available next time.
      </p>

      <Form
        label="Record and assess"
        onSubmit={(values) =>
          api("/transactions/entry", "POST", {
            reference: values.reference,
            amount: values.amount,
            city: values.city,

            account_id: newAccount
              ? null
              : Number(values.account_id),

            new_account: newAccount
              ? {
                  reference: values.account_number.trim(),
                  name: values.holder.trim(),
                  city: values.home_city,
                  usual_amount: values.usual_amount,
                }
              : null,

            merchant_id: newMerchant
              ? null
              : Number(values.merchant_id),

            new_merchant_name: newMerchant
              ? values.merchant_name.trim()
              : null,

            merchant_category:
              values.merchant_category || "Retail",

            device_id: newDevice
              ? null
              : Number(values.device_id),

            new_device_reference: newDevice
              ? values.device_reference.trim()
              : null,

            receiver_id: values.receiver_id
              ? Number(values.receiver_id)
              : null,
          })
        }
        after={(result) =>
          navigate("/transactions/" + result.transaction.id)
        }
      >
        <h2>Account</h2>

        <label>
          Account selection
          <select
            value={newAccount ? "new" : "existing"}
            onChange={(event) => setAccountMode(event.target.value)}
          >
            <option
              value="existing"
              disabled={!accounts.data.length}
            >
              Use saved account
            </option>
            <option value="new">Add new account</option>
          </select>
        </label>

        {newAccount ? (
          <div className="form-grid">
            <Field name="account_number" label="Account number" />
            <Field name="holder" label="Account holder" />
            <Field name="home_city" label="Home city" />

            <Field
              name="usual_amount"
              label="Usual transaction amount (INR)"
              type="number"
              value="2000"
            />
          </div>
        ) : (
          <Select
            name="account_id"
            label="Saved account"
            options={accounts.data.map((account: any) => ({
              value: account.id,
              label: account.reference + " · " + account.name,
            }))}
          />
        )}

        <h2>Merchant</h2>

        <label>
          Merchant selection
          <select
            value={newMerchant ? "new" : "existing"}
            onChange={(event) => setMerchantMode(event.target.value)}
          >
            <option
              value="existing"
              disabled={!catalogue.data.merchants.length}
            >
              Use saved merchant
            </option>
            <option value="new">Add new merchant</option>
          </select>
        </label>

        {newMerchant ? (
          <div className="form-grid">
            <Field name="merchant_name" label="Merchant name" />

            <Field
              name="merchant_category"
              label="Merchant category"
              value="Retail"
            />
          </div>
        ) : (
          <Select
            name="merchant_id"
            label="Saved merchant"
            options={catalogue.data.merchants.map((merchant: any) => ({
              value: merchant.id,
              label: merchant.name,
            }))}
          />
        )}

        <h2>Payment details</h2>

        <div className="form-grid">
          <Field
            name="reference"
            label="Unique transaction reference"
            value={reference}
          />

          <Field name="amount" label="Amount (INR)" type="number" />
          <Field name="city" label="Transaction city" />

          <label>
            Receiving account (optional)
            <select name="receiver_id">
              <option value="">None</option>

              {accounts.data.map((account: any) => (
                <option key={account.id} value={account.id}>
                  {account.reference} · {account.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <h2>Device</h2>

        <label>
          Device selection
          <select
            value={newDevice ? "new" : "existing"}
            onChange={(event) => setDeviceMode(event.target.value)}
          >
            <option
              value="existing"
              disabled={!catalogue.data.devices.length}
            >
              Use saved device
            </option>
            <option value="new">Add new device</option>
          </select>
        </label>

        {newDevice ? (
          <Field
            name="device_reference"
            label="Device reference (for example MY-LAPTOP)"
          />
        ) : (
          <Select
            name="device_id"
            label="Saved device"
            options={catalogue.data.devices.map((device: any) => ({
              value: device.id,
              label: device.reference,
            }))}
          />
        )}
      </Form>
    </>
  );
}

// Transaction detail

function TransactionDetail() {
  const { id } = useParams();
  const data = useData("/transactions/" + id);
  const navigate = useNavigate();
  const [scenario, setScenario] = useState<any>();

  if (!data.data) return <Message error={data.error} />;

  const {
    transaction,
    prediction,
    factors,
  } = data.data;

  return (
    <>
      <header>
        <div>
          <p className="eyebrow">TRANSACTION RECORD</p>
          <h1 className="mono">{transaction.reference}</h1>
        </div>

        <strong className="large-amount">
          {money(transaction.amount)}
        </strong>
      </header>

      <div className="record-meta">
        <Link to={"/accounts/" + transaction.account_id}>
          View account
        </Link>
        <span>{date(transaction.occurred_at)}</span>
        <span>{transaction.city}</span>
        <span>{transaction.channel}</span>
      </div>

      {prediction && (
        <>
          <div className="assessment">
            <div>
              <p className="eyebrow">COMBINED RISK</p>

              <strong className="score">
                {prediction.score}
                <small> / 1000</small>
              </strong>

              <Status value={prediction.tier} />

              <p>Recommended action: {prediction.action}</p>
            </div>

            <div className="component-list">
              {Object.entries(prediction.components).map(
                ([name, value]) => (
                  <div key={name}>
                    <span>{name.replaceAll("_", " ")}</span>
                    <progress value={Number(value)} max={1} />
                    <span className="mono">
                      {(Number(value) * 100).toFixed(1)}%
                    </span>
                  </div>
                ),
              )}
            </div>
          </div>

          <p className="footnote">
            Behaviour is an anomaly percentile, not a fraud probability.
            Other model scores are combined and calibrated by the ensemble.
          </p>

          <h2>Decision factors</h2>

          <Table
            rows={factors}
            columns={[
              ["Factor", (row) => row.message],
              [
                "Contribution",
                (row) => Number(row.contribution).toFixed(3),
              ],
            ]}
          />

          <p className="footnote">
            TreeSHAP contributions explain the transaction model in
            log-odds, not the final combined score.
          </p>

          <div className="two-col">
            <section>
              <h2>Open investigation</h2>

              <Form
                label="Create case"
                onSubmit={(values) =>
                  api("/cases", "POST", {
                    ...values,
                    transaction_id: Number(id),
                    account_id: transaction.account_id,
                  })
                }
                after={(result) => navigate("/cases/" + result.id)}
              >
                <Field
                  name="title"
                  label="Case title"
                  value={"Review " + transaction.reference}
                />
              </Form>

              <h2>Analyst outcome</h2>

              <Form
                onSubmit={(values) =>
                  api(
                    "/transactions/" + id + "/feedback",
                    "POST",
                    values,
                  )
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
                onSubmit={(values) =>
                  api(
                    "/transactions/" + id + "/scenario",
                    "POST",
                    {
                      amount: values.amount,
                      trusted_device: values.trusted_device === "yes",
                    },
                  )
                }
                after={setScenario}
              >
                <Field
                  name="amount"
                  label="Hypothetical amount"
                  type="number"
                  value={transaction.amount}
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
            rows={data.data.feedback}
            columns={[
              ["Outcome", (row) => row.outcome],
              ["Reason", (row) => row.reason],
              ["Recorded", (row) => date(row.created_at)],
            ]}
          />
        </>
      )}
    </>
  );
}

// Customer accounts

function Accounts() {
  const data = useData("/accounts");
  const [show, setShow] = useState(false);
  const navigate = useNavigate();

  return (
    <>
      <header>
        <h1>Customer accounts</h1>

        <button onClick={() => setShow(!show)}>
          {show ? "Cancel" : "Create customer account"}
        </button>
      </header>

      {show && (
        <section className="editor">
          <Form
            onSubmit={(values) => api("/accounts", "POST", values)}
            after={(result) => navigate("/accounts/" + result.id)}
          >
            <div className="form-grid">
              <Field name="name" label="Account holder" />
              <Field name="reference" label="Account number" />
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

      <Message error={data.error} />

      <Table
        rows={data.data || []}
        columns={[
          [
            "Account",
            (row) => (
              <Link to={"/accounts/" + row.id}>
                {row.reference}
              </Link>
            ),
          ],
          ["Holder", (row) => row.name],
          ["City", (row) => row.city],
          ["Opened", (row) => date(row.opened_at)],
          ["Status", (row) => <Status value={row.status} />],
        ]}
      />
    </>
  );
}

function AccountDetail() {
  const { id } = useParams();
  const data = useData("/accounts/" + id);

  if (!data.data) return <Message error={data.error} />;

  const {
    account,
    transactions,
    events,
  } = data.data;

  return (
    <>
      <header>
        <div>
          <p className="eyebrow">
            ACCOUNT RECORD / {account.reference}
          </p>
          <h1>{account.name}</h1>
        </div>

        <Link
          className="button secondary"
          to={"/network/" + id}
        >
          Inspect connections
        </Link>
      </header>

      <div className="record-meta">
        <span>{account.city}</span>
        <span>Opened {date(account.opened_at)}</span>
        <Status value={account.status} />
      </div>

      <Chart
        title="Recent transaction amounts"
        data={[
          {
            type: "scatter",
            mode: "lines+markers",
            x: [...transactions]
              .reverse()
              .map((transaction: any) => transaction.occurred_at),
            y: [...transactions]
              .reverse()
              .map((transaction: any) => Number(transaction.amount)),
            line: { color: "#164e63", width: 1.5 },
            marker: { size: 4 },
          },
        ]}
      />

      <h2>Transaction history</h2>

      <Table columns={txColumns} rows={transactions} />

      <Link to="/transactions">Search the full ledger</Link>

      <div className="two-col">
        <section>
          <h2>Security event timeline</h2>

          <Table
            rows={events}
            columns={[
              ["Event", (row) => row.kind.replaceAll("_", " ")],
              ["Time", (row) => date(row.occurred_at)],
            ]}
          />
        </section>

        <section>
          <h2>Record security event</h2>

          <Form
            onSubmit={(values) =>
              api("/events", "POST", {
                ...values,
                account_id: Number(id),
              })
            }
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
            rows={data.data.devices}
            columns={[
              ["Device", (row) => "DEV-" + row.device_id],
              [
                "Trust",
                (row) => (row.trusted ? "Trusted" : "Unverified"),
              ],
            ]}
          />
        </section>
      </div>
    </>
  );
}

// Devices and merchants

function Catalogue() {
  return (
    <div className="two-col">
      <section>
        <h2>Register device</h2>

        <Form
          onSubmit={(values) => api("/devices", "POST", values)}
        >
          <Field
            name="reference"
            label="Unique device reference"
          />

          <Select
            name="kind"
            label="Device type"
            options={["mobile", "desktop", "terminal"]}
          />
        </Form>
      </section>

      <section>
        <h2>Register merchant</h2>

        <Form
          onSubmit={(values) => api("/merchants", "POST", values)}
        >
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

// Network account selector
// Only mounts the graph after finding an existing account.

function Network() {
  const { id } = useParams();
  const navigate = useNavigate();
  const accounts = useData("/accounts");

  const records = accounts.data || [];

  const selectedAccount =
    records.find(
      (account: any) => String(account.id) === id,
    ) || records[0];

  useEffect(() => {
    if (
      selectedAccount &&
      String(selectedAccount.id) !== id
    ) {
      navigate(
        "/network/" + selectedAccount.id,
        { replace: true },
      );
    }
  }, [selectedAccount?.id, id, navigate]);

  return (
    <>
      <header>
        <h1>Network investigation</h1>
      </header>

      <Message error={accounts.error} />

      {accounts.isPending ? (
        <p className="muted">Loading your accounts…</p>
      ) : accounts.error ? null : !selectedAccount ? (
        <>
          <p className="muted">
            Create an account and record a transaction to explore
            its connections.
          </p>

          <Link className="button" to="/submit">
            Record transaction
          </Link>
        </>
      ) : (
        <>
          <label>
            Account number
            <select
              value={String(selectedAccount.id)}
              onChange={(event) =>
                navigate("/network/" + event.target.value)
              }
            >
              {records.map((account: any) => (
                <option
                  key={account.id}
                  value={String(account.id)}
                >
                  {account.reference} · {account.name}
                </option>
              ))}
            </select>
          </label>

          <p className="muted">
            Choose a saved account to inspect its connections.
          </p>

          <NetworkGraph
            key={selectedAccount.id}
            accountId={String(selectedAccount.id)}
          />
        </>
      )}
    </>
  );
}

// Network graph

function NetworkGraph({
  accountId,
}: {
  accountId: string;
}) {
  const data = useData("/network/" + accountId);
  const ref = useRef<HTMLDivElement>(null);

  const [selected, setSelected] = useState("");
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    if (!data.data || !ref.current) return;

    const centre = `A${accountId}`;
    const allNodes = data.data.nodes as any[];
    const allEdges = data.data.edges as any[];

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

    const selectedIds = new Set<string>([centre]);
    const queue = [centre];

    while (queue.length && selectedIds.size < 36) {
      const current = queue.shift()!;

      for (const next of neighbours.get(current) || []) {
        if (selectedIds.size >= 36) break;

        if (!selectedIds.has(next)) {
          selectedIds.add(next);
          queue.push(next);
        }
      }
    }

    const nodes = allNodes.filter((node) =>
      selectedIds.has(node.data.id),
    );

    const edges = allEdges.filter(
      (edge) =>
        selectedIds.has(edge.data.source) &&
        selectedIds.has(edge.data.target),
    );

    setVisibleCount(nodes.length);

    const cy = cytoscape({
      container: ref.current,
      elements: [...nodes, ...edges],

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
            "text-opacity": 0,
            "text-background-color": "#fafbf8",
            "text-background-opacity": 0.94,
            "text-background-padding": "4px",
            "text-margin-y": -20,
            "text-wrap": "none",
          },
        },
        {
          selector: 'node[kind="device"]',
          style: {
            shape: "round-rectangle",
            "background-color": "#d0b889",
            width: 27,
            height: 27,
          },
        },
        {
          selector: 'node[kind="merchant"]',
          style: {
            shape: "diamond",
            "background-color": "#8fa6a0",
            width: 27,
            height: 27,
          },
        },
        {
          selector: `node[id="A${accountId}"]`,
          style: {
            "background-color": "#164e63",
            width: 42,
            height: 42,
            color: "#123f50",
            "text-opacity": 1,
            "font-size": 12,
          },
        },
        {
          selector: "node.reveal-label, node:selected",
          style: {
            "text-opacity": 1,
            "border-width": 2,
            "border-color": "#164e63",
          },
        },
        {
          selector: "edge",
          style: {
            width: 1,
            "line-color": "#d4d8d3",
            "curve-style": "bezier",
            opacity: 0.8,
          },
        },
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

    cy.on("mouseover", "node", (event) => {
      event.target.addClass("reveal-label");
      event.target.connectedEdges().addClass("highlighted");
    });

    cy.on("mouseout", "node", (event) => {
      if (!event.target.selected()) {
        event.target.removeClass("reveal-label");
      }

      event.target.connectedEdges().removeClass("highlighted");
    });

    cy.on("tap", "node", (event) => {
      setSelected(event.target.id());
      cy.nodes().removeClass("reveal-label");
      event.target.addClass("reveal-label");
    });

    cy.on("tap", (event) => {
      if (event.target === cy) {
        setSelected("");
        cy.nodes().removeClass("reveal-label");
      }
    });

    return () => {
      cy.destroy();
    };
  }, [data.data, accountId]);

  return (
    <>
      <Message error={data.error} />

      <div ref={ref} className="network" />

      {data.data && (
        <p className="muted small">
          Showing {visibleCount} focused nodes from{" "}
          {data.data.nodes.length} in the two-hop network.
          Hover over a node to reveal its label; drag or scroll to explore.
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
        {data.data?.scope} Teal: investigated account.
        Grey: linked account. Gold square: device.
        Green diamond: merchant.
      </p>
    </>
  );
}

function RingCandidates() {
  const data = useData("/fraud-rings");

  return (
    <section>
      <h2>Shared-device communities</h2>

      <p className="muted">
        Candidate associations for investigation. Shared infrastructure
        alone does not establish fraud.
      </p>

      <Message error={data.error} />

      <Table
        rows={data.data || []}
        columns={[
          [
            "Community",
            (row) => (
              <Link to={"/network/" + row.id}>
                Inspect {row.id}
              </Link>
            ),
          ],
          ["Accounts", (row) => row.accounts],
          ["Shared devices", (row) => row.shared_devices],
          ["Density", (row) => row.density.toFixed(2)],
          ["Highest recorded score", (row) => row.max_risk_score],
        ]}
      />
    </section>
  );
}

// Alert queue

function Alerts() {
  const data = useData("/alerts");
  const queryClient = useQueryClient();
  const [error, setError] = useState<any>();

  return (
    <>
      <header>
        <h1>Alert queue</h1>
      </header>

      <Message error={error || data.error} />

      <Table
        rows={data.data || []}
        columns={[
          ["Alert", (row) => "AL-" + row.id],
          [
            "Transaction",
            (row) => (
              <Link to={"/transactions/" + row.transaction_id}>
                View transaction {row.transaction_id}
              </Link>
            ),
          ],
          [
            "Account",
            (row) => (
              <Link to={"/accounts/" + row.account_id}>
                {row.account_id}
              </Link>
            ),
          ],
          ["Opened", (row) => date(row.created_at)],
          [
            "Status",
            (row) => (
              <select
                aria-label={"Alert " + row.id + " status"}
                value={row.status}
                onChange={async (event) => {
                  try {
                    await api(
                      "/alerts/" + row.id,
                      "PATCH",
                      { status: event.target.value },
                    );

                    await queryClient.invalidateQueries();
                  } catch (err) {
                    setError(err);
                  }
                }}
              >
                {[
                  "new",
                  "under_review",
                  "escalated",
                  "resolved",
                  "dismissed",
                ].map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            ),
          ],
        ]}
      />
    </>
  );
}

// Investigations

function Cases() {
  const data = useData("/cases");
  const navigate = useNavigate();

  return (
    <>
      <header>
        <h1>Investigations</h1>
      </header>

      <Message error={data.error} />

      <Form
        label="Open case"
        onSubmit={(values) => api("/cases", "POST", values)}
        after={(result) => navigate("/cases/" + result.id)}
      >
        <Field name="title" label="New case title" />
      </Form>

      <Table
        rows={data.data || []}
        columns={[
          [
            "Case",
            (row) => (
              <Link to={"/cases/" + row.id}>
                CASE-{row.id}
              </Link>
            ),
          ],
          ["Title", (row) => row.title],
          ["Status", (row) => <Status value={row.status} />],
          ["Assigned to", (row) => row.assigned_to],
          ["Opened", (row) => date(row.created_at)],
        ]}
      />
    </>
  );
}

function CaseDetail({ user }: { user: any }) {
  const { id } = useParams();
  const data = useData("/cases/" + id);

  if (!data.data) return <Message error={data.error} />;

  const caseRecord = data.data.case;

  return (
    <>
      <header>
        <div>
          <p className="eyebrow">CASE-{id}</p>
          <h1>{caseRecord.title}</h1>
        </div>

        <Status value={caseRecord.status} />
      </header>

      <p>
        Linked transactions:{" "}
        {data.data.transactions.map((transactionId: number) => (
          <Link
            key={transactionId}
            to={"/transactions/" + transactionId}
          >
            {" "}{transactionId}{" "}
          </Link>
        ))}
      </p>

      <p>
        Linked accounts:{" "}
        {data.data.accounts.map((accountId: number) => (
          <Link
            key={accountId}
            to={"/accounts/" + accountId}
          >
            {" "}{accountId}{" "}
          </Link>
        ))}
      </p>

      <h2>Investigation notes</h2>

      {data.data.notes.map((note: any) => (
        <article className="note" key={note.id}>
          <p>{note.text}</p>

          <span className="muted">
            Staff {note.author_id} · {date(note.created_at)}
          </span>
        </article>
      ))}

      <Form
        label="Add note"
        onSubmit={(values) =>
          api("/cases/" + id + "/notes", "POST", values)
        }
      >
        <label>
          Note
          <textarea
            name="text"
            required
            maxLength={3000}
          />
        </label>
      </Form>

      {user.role !== "analyst" && (
        <>
          <h2>Case disposition</h2>

          <Form
            onSubmit={(values) =>
              api("/cases/" + id, "PATCH", values)
            }
          >
            <Select
              name="status"
              label="Status"
              options={[
                "open",
                "under_review",
                "escalated",
                "closed",
              ]}
              value={caseRecord.status}
            />

            <Field
              name="resolution"
              label="Resolution"
              required={false}
              value={caseRecord.resolution || ""}
            />
          </Form>
        </>
      )}
    </>
  );
}

// Model evaluation

function Models() {
  const data = useData("/models");

  if (!data.data) return <Message error={data.error} />;

  const metrics = data.data.metrics;

  return (
    <>
      <header>
        <div>
          <p className="eyebrow">
            VALIDATION / {data.data.version}
          </p>
          <h1>Model analysis</h1>
        </div>
      </header>

      <p className="muted">
        {metrics.dataset}. Held-out evaluation:{" "}
        {metrics.test_rows.toLocaleString()} rows.
        Positive rate:{" "}
        {(metrics.positive_rate * 100).toFixed(2)}%.
      </p>

      <div className="summary">
        {[
          ["Average precision", metrics.average_precision],
          ["ROC AUC", metrics.roc_auc],
          ["Brier score", metrics.brier_score],
        ].map(([name, value]) => (
          <div key={name}>
            <span>{name}</span>
            <strong>{Number(value).toFixed(3)}</strong>
          </div>
        ))}
      </div>

      <div className="two-col">
        <Chart
          title="Precision–recall curve"
          data={[
            {
              x: metrics.curves.recall,
              y: metrics.curves.precision,
              type: "scatter",
              line: { color: "#164e63" },
            },
          ]}
        />

        <Chart
          title="Calibration"
          data={[
            {
              x: metrics.curves.calibration_predicted,
              y: metrics.curves.calibration_observed,
              type: "scatter",
              mode: "lines+markers",
              line: { color: "#164e63" },
            },
            {
              x: [0, 1],
              y: [0, 1],
              type: "scatter",
              line: {
                color: "#aaa",
                dash: "dot",
              },
            },
          ]}
        />
      </div>

      <h2>Model comparison</h2>

      <Table
        rows={[
          {
            name: "Transaction classifier",
            ap: metrics.transaction_average_precision,
          },
          {
            name: "Network classifier",
            ap: metrics.network_average_precision,
          },
          {
            name: "Calibrated ensemble",
            ap: metrics.average_precision,
          },
        ]}
        columns={[
          ["Model", (row) => row.name],
          ["Average precision", (row) => row.ap.toFixed(4)],
        ]}
      />

      <h2>Confusion matrix at probability 0.5</h2>

      <Table
        rows={metrics.confusion_matrix_at_0_5.map(
          (row: number[], index: number) => ({
            label: index ? "Actual fraud" : "Actual legitimate",
            negative: row[0],
            positive: row[1],
          }),
        )}
        columns={[
          ["Actual class", (row) => row.label],
          ["Predicted legitimate", (row) => row.negative],
          ["Predicted fraud", (row) => row.positive],
        ]}
      />

      <p className="footnote">
        Training uses independent base-fit, ensemble-fit, calibration
        and test partitions. Simulation results do not establish
        operational performance.
      </p>
    </>
  );
}

// System monitoring

function System({ user }: { user: any }) {
  const data = useData("/monitoring");
  const thresholds = useData("/thresholds");

  return (
    <>
      <header>
        <h1>System monitoring</h1>
      </header>

      <p className="muted">
        Distribution comparison against the synthetic training reference.
        Drift does not itself establish reduced detection accuracy.
      </p>

      <Message error={data.error || thresholds.error} />

      {user.role !== "analyst" && (
        <Form
          label="Measure feature drift"
          onSubmit={() => api("/monitoring/run", "POST", {})}
        >
          <span />
        </Form>
      )}

      <Table
        rows={data.data || []}
        columns={[
          ["Feature", (row) => row.feature],
          ["KS statistic", (row) => row.statistic.toFixed(3)],
          ["P value", (row) => row.p_value.toExponential(2)],
          ["Samples", (row) => row.sample_size],
          ["Measured", (row) => date(row.created_at)],
        ]}
      />

      {user.role === "admin" && thresholds.data && (
        <>
          <h2>Risk thresholds</h2>

          <p className="muted">
            Changes apply to new assessments. Historical decisions
            retain their original tier.
          </p>

          <Form
            onSubmit={(values) =>
              api("/thresholds", "POST", values)
            }
          >
            <div className="form-grid">
              {["low", "medium", "high"].map((key) => (
                <Field
                  key={key}
                  name={key}
                  label={key + " maximum"}
                  type="number"
                  value={thresholds.data[key]}
                />
              ))}
            </div>
          </Form>
        </>
      )}
    </>
  );
}

// User administration

function Users() {
  const users = useData("/users");
  const sessions = useData("/sessions");
  const queryClient = useQueryClient();
  const [error, setError] = useState<any>();

  return (
    <>
      <header>
        <h1>User administration</h1>
      </header>

      <p className="muted">
        Staff records and session history stored in the database.
        Passwords and session secrets are never displayed.
      </p>

      <Message error={error || users.error || sessions.error} />

      <Table
        rows={users.data || []}
        columns={[
          ["Name", (row) => row.name],
          ["Email", (row) => row.email],
          [
            "Role",
            (row) => (
              <select
                value={row.role}
                aria-label={"Role for " + row.email}
                onChange={async (event) => {
                  try {
                    await api(
                      "/users/" + row.id,
                      "PATCH",
                      {
                        role: event.target.value,
                        active: row.active,
                      },
                    );

                    await queryClient.invalidateQueries();
                  } catch (err) {
                    setError(err);
                  }
                }}
              >
                {["analyst", "supervisor", "admin"].map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </select>
            ),
          ],
          [
            "Status",
            (row) => (
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await api(
                      "/users/" + row.id,
                      "PATCH",
                      {
                        role: row.role,
                        active: !row.active,
                      },
                    );

                    await queryClient.invalidateQueries();
                  } catch (err) {
                    setError(err);
                  }
                }}
              >
                {row.active
                  ? "Active — disable"
                  : "Disabled — enable"}
              </button>
            ),
          ],
          ["Last sign in", (row) => date(row.last_login_at)],
        ]}
      />

      <h2>Session records</h2>

      <Table
        rows={sessions.data || []}
        columns={[
          ["Session", (row) => row.id],
          ["User", (row) => row.user_id],
          ["Created", (row) => date(row.created_at)],
          ["Expires", (row) => date(row.expires_at)],
          ["Signed out", (row) => date(row.revoked_at)],
        ]}
      />
    </>
  );
}

// Audit history

function Audit() {
  const data = useData("/audit");

  return (
    <>
      <header>
        <h1>Audit history</h1>
      </header>

      <Message error={data.error} />

      <Table
        rows={data.data || []}
        columns={[
          ["Time", (row) => date(row.created_at)],
          ["User", (row) => row.user_id],
          [
            "Action",
            (row) => row.action.replaceAll("_", " "),
          ],
          ["Record", (row) => row.entity],
          [
            "Details",
            (row) => <code>{JSON.stringify(row.detail)}</code>,
          ],
        ]}
      />
    </>
  );
}

// Application layout and routing

function App() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>();

  useEffect(() => {
    api("/auth/me")
      .then((result) => {
        csrf = result.csrf;
        setSession(result);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="loading">Opening workspace…</div>;
  }

  if (!session) {
    return (
      <Auth
        done={(result) => {
          csrf = result.csrf;
          setSession(result);
          client.clear();
        }}
      />
    );
  }

  const user = session.user;

  const links = [
    ["/", "Overview"],
    ["/transactions", "Transactions"],
    ["/alerts", "Alerts"],
    ["/cases", "Investigations"],
    ["/network/1", "Networks"],
    ["/accounts", "Accounts"],
    ["/models", "Models"],
    ["/system", "System"],
    ...(user.role === "admin"
      ? [["/users", "Users"]]
      : []),
    ...(user.role !== "analyst"
      ? [["/audit", "Audit history"]]
      : []),
  ];

  return (
    <div className="shell">
      <aside>
        <Link to="/" className="wordmark">
          FRAUDERIO
          <span>TRANSACTION MONITORING</span>
        </Link>

        <nav>
          {links.map(([to, label]) => (
            <NavLink
              end={to === "/"}
              key={to}
              to={to}
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="identity">
          <strong>{user.name}</strong>
          <span>{user.role}</span>

          <button
            className="text-button"
            onClick={async () => {
              try {
                await api("/auth/logout", "POST", {});
                csrf = "";
                setSession(null);
                client.clear();
              } catch (err) {
                setError(err);
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
          <span className="mono">
            INR · TRANSACTION RECORDS
          </span>
        </div>

        <main>
          <Routes>
            <Route path="/" element={<Overview />} />

            <Route
              path="/transactions"
              element={<Transactions />}
            />

            <Route
              path="/transactions/:id"
              element={<TransactionDetail />}
            />

            <Route
              path="/submit"
              element={<Submit />}
            />

            <Route
              path="/accounts"
              element={
                <>
                  <Accounts />
                  <Catalogue />
                </>
              }
            />

            <Route
              path="/accounts/:id"
              element={<AccountDetail />}
            />

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

            <Route
              path="/cases/:id"
              element={<CaseDetail user={user} />}
            />

            <Route path="/models" element={<Models />} />

            <Route
              path="/system"
              element={<System user={user} />}
            />

            <Route path="/users" element={<Users />} />

            <Route path="/audit" element={<Audit />} />

            <Route
              path="*"
              element={<Empty text="Page not found" />}
            />
          </Routes>
        </main>

        <footer>
          Frauderio Nexus · Investigation workspace ·
          All times displayed locally
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