// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { isLocalRepositoryKey, repositoryFolderLabel, type FixedLine, type Project, type ProjectFileProblem, type ProjectsFile, type ProjectsState, type RepositoryList } from "@agent-cost-analyzer/domain";

// A local repository by its folder, as the list boxes name it, never its path.
const repositoryLabel = (key: string) => (isLocalRepositoryKey(key) ? `${repositoryFolderLabel(key)} (local)` : key);
import { fetchProjects, fetchRepositoryList, saveProjects } from "../../api-client/statements.js";
import {
  addCaptureRule,
  addMember,
  addProject,
  assignRepository,
  branchesText,
  problemsOf,
  removeCaptureRule,
  removeMember,
  removeProject,
  renameProject,
  unassignedRepositories,
  updateCaptureRule,
  updateMember,
  updateProject,
} from "../../lib/projects/editor-model.js";
import { useCancellableLoad } from "../../lib/use-cancellable-load.js";
import { AsyncView, cancelledEmptyState } from "../ui/AsyncView.js";
import { Blueprint } from "../ui/Blueprint.js";

// Phase 15 step 15.11 (plan §7, §11.5; board 5): the Projects editor, a
// settings page opened from the Dashboard. Repositories without a project
// come first, each assigned with a Project select (keyboard alone; there is
// no drag, so it is never the only way, WCAG 2.2 2.5.7). Problems (an exact
// tie, a missing name, a project with no members) show beside their field
// and in a summary at the top, and Save is disabled while any remain.
// Unattributed sessions say why, with a capture rule to fix mitmproxy's.

interface ProjectsEditorProps {
  onBack: () => void;
  loadProjects?: (signal: AbortSignal) => Promise<ProjectsState>;
  loadRepositories?: (signal: AbortSignal) => Promise<RepositoryList>;
  save?: (file: ProjectsFile) => Promise<ProjectsState>;
}

interface Loaded {
  state: ProjectsState;
  repositories: RepositoryList;
}

export function ProjectsEditor({ onBack, loadProjects = fetchProjects, loadRepositories = fetchRepositoryList, save = saveProjects }: ProjectsEditorProps) {
  const load = useCallback(async (signal: AbortSignal): Promise<Loaded> => {
    const [state, repositories] = await Promise.all([loadProjects(signal), loadRepositories(signal)]);
    return { state, repositories };
  }, [loadProjects, loadRepositories]);
  const { state, cancel, retry } = useCancellableLoad(load);

  return (
    <div className="projects-editor">
      <div className="projects-head">
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          ← Back to the Dashboard
        </button>
        <h2 className="projects-title">Projects</h2>
      </div>
      <AsyncView
        status={state.kind === "ready" ? "ready" : state.kind === "cancelled" ? "empty" : state.kind}
        loadingText="Loading projects and repositories…"
        onCancel={cancel}
        error={state.kind === "error" ? { title: `Could not load the projects: ${state.message}`, onRetry: retry } : undefined}
        empty={cancelledEmptyState(retry)}
      >
        {state.kind === "ready" && <EditorBody initial={state.data.state} repositories={state.data.repositories} save={save} />}
      </AsyncView>
    </div>
  );
}

const problemsAt = (problems: readonly ProjectFileProblem[], prefix: string) =>
  problems.filter((problem) => problem.path === prefix || problem.path.startsWith(`${prefix}.`) || problem.path.startsWith(`${prefix}[`));

function EditorBody({ initial, repositories, save }: { initial: ProjectsState; repositories: RepositoryList; save: (file: ProjectsFile) => Promise<ProjectsState> }) {
  const [file, setFile] = useState<ProjectsFile>(initial.file);
  const [savedIds, setSavedIds] = useState(() => new Set(initial.file.projects.map((project) => project.id)));
  const [location, setLocation] = useState(initial.location);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [focusProject, setFocusProject] = useState<number | null>(null);
  const problems = useMemo(() => problemsOf(file), [file]);
  const unassigned = useMemo(() => unassignedRepositories(repositories, file), [repositories, file]);
  const keys = repositories.repositories.map((entry) => entry.key);

  const edit = (next: ProjectsFile) => {
    setFile(next);
    setDirty(true);
    setStatus(null);
  };

  const onSave = async () => {
    try {
      const saved = await save(file);
      setFile(saved.file);
      setSavedIds(new Set(saved.file.projects.map((project) => project.id)));
      setLocation(saved.location);
      setDirty(false);
      setStatus("Saved. The Dashboard uses the new projects from its next load.");
    } catch (error) {
      setStatus(`Not saved: ${error instanceof Error ? error.message : String(error)}. Nothing was changed.`);
    }
  };

  return (
    <>
      <div className="projects-toolbar">
        <span className="text-muted">
          Saved in {location} · holds no message text
        </span>
        <span className="projects-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              edit(addProject(file, "New project"));
              setFocusProject(file.projects.length);
            }}
          >
            New project
          </button>
          <button type="button" className="btn btn-primary" disabled={problems.length > 0 || !dirty} aria-describedby={problems.length > 0 ? "projects-summary" : undefined} onClick={() => void onSave()}>
            Save
          </button>
        </span>
      </div>
      {status && (
        <p role="status" className="projects-status">
          {status}
        </p>
      )}
      {problems.length > 0 && (
        <div id="projects-summary" role="alert" className="projects-summary">
          <strong>
            {problems.length} {problems.length === 1 ? "problem" : "problems"} to fix before saving
          </strong>
          <ul>
            {problems.map((problem) => (
              <li key={`${problem.path}-${problem.message}`}>{problem.message}</li>
            ))}
          </ul>
        </div>
      )}

      {unassigned.length > 0 && (
        <Blueprint className="audit-section">
          <div className="card-kicker">Listed first</div>
          <table className="table">
            <caption className="cost-chart-title">Repositories without a project</caption>
            <thead>
              <tr>
                <th scope="col">Repository</th>
                <th scope="col" className="num">
                  Sessions
                </th>
                <th scope="col">Last used</th>
                <th scope="col">Assign to</th>
              </tr>
            </thead>
            <tbody>
              {unassigned.map((entry) => (
                <tr key={entry.key}>
                  <td>
                    <code>{repositoryLabel(entry.key)}</code>
                  </td>
                  <td className="num">{entry.sessionCount}</td>
                  <td>{entry.lastUsedAt ? entry.lastUsedAt.slice(0, 10) : "unknown"}</td>
                  <td>
                    <select
                      className="input"
                      aria-label={`Assign ${repositoryLabel(entry.key)} to`}
                      value=""
                      disabled={file.projects.length === 0}
                      onChange={(event) => edit(assignRepository(file, entry.key, event.target.value))}
                    >
                      <option value="">{file.projects.length === 0 ? "Create a project first" : "Choose a project"}</option>
                      {file.projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-muted cost-note">Assign each repository with its select, by keyboard alone.</p>
        </Blueprint>
      )}

      <Blueprint className="audit-section">
        <h3 className="cost-chart-title">Capture rules</h3>
        {repositories.unattributed.map((entry) => (
          <p key={entry.reason} className="cost-note">
            <strong>
              {entry.sessionCount} {entry.sessionCount === 1 ? "session is" : "sessions are"} Unattributed: {entry.reason}
            </strong>{" "}
            A capture rule assigns capture files (mitmproxy records no folder) to a repository.
          </p>
        ))}
        {file.captureRules.map((rule, index) => (
          <div key={index} className="projects-row">
            <label className="field">
              <span>Capture files (glob)</span>
              <input className="input" value={rule.glob} onChange={(event) => edit(updateCaptureRule(file, index, { glob: event.target.value }))} {...fieldError(problemsAt(problems, `captureRules[${index}]`), `rule-${index}`)} />
            </label>
            <label className="field">
              <span>Repository for these captures</span>
              <select className="input" value={rule.repository} onChange={(event) => edit(updateCaptureRule(file, index, { repository: event.target.value }))}>
                <option value="">Choose a repository</option>
                {keys.map((key) => (
                  <option key={key} value={key}>
                    {repositoryLabel(key)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-secondary" aria-label={`Remove capture rule ${index + 1}`} onClick={() => edit(removeCaptureRule(file, index))}>
              Remove
            </button>
            <FieldErrors id={`rule-${index}`} problems={problemsAt(problems, `captureRules[${index}]`)} />
          </div>
        ))}
        <div className="projects-row">
          <button type="button" className="btn btn-secondary" onClick={() => edit(addCaptureRule(file, "", ""))}>
            Add a capture rule
          </button>
        </div>
      </Blueprint>

      {file.projects.map((project, index) => (
        <ProjectCard
          key={index}
          project={project}
          index={index}
          keys={keys}
          problems={problemsAt(problems, `projects[${index}]`)}
          autoFocus={focusProject === index}
          onChange={(patch) => edit(updateProject(file, index, patch))}
          onRename={(name) => edit(renameProject(file, index, name, savedIds))}
          onAddMember={(key) => edit(addMember(file, index, key))}
          onMember={(memberIndex, patch) => edit(updateMember(file, index, memberIndex, patch))}
          onRemoveMember={(memberIndex) => edit(removeMember(file, index, memberIndex))}
          onRemove={() => edit(removeProject(file, index))}
        />
      ))}
      <p className="text-muted cost-note">Most specific member wins: a path beats a whole repository, a branch scope beats none. A turn counts in one project only.</p>
    </>
  );
}

function fieldError(problems: readonly ProjectFileProblem[], id: string) {
  return problems.length > 0 ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};
}

function FieldErrors({ id, problems }: { id: string; problems: readonly ProjectFileProblem[] }) {
  if (problems.length === 0) return null;
  return (
    <span id={`${id}-error`} className="field-error">
      {problems.map((problem) => problem.message).join(" ")}
    </span>
  );
}

interface ProjectCardProps {
  project: Project;
  index: number;
  keys: readonly string[];
  problems: readonly ProjectFileProblem[];
  autoFocus: boolean;
  onChange: (patch: Partial<Omit<Project, "members">>) => void;
  onRename: (name: string) => void;
  onAddMember: (key: string) => void;
  onMember: (memberIndex: number, patch: { path?: string; branches?: string }) => void;
  onRemoveMember: (memberIndex: number) => void;
  onRemove: () => void;
}

const numberOrUndefined = (text: string) => (text.trim() === "" ? undefined : Number(text));

function ProjectCard({ project, index, keys, problems, autoFocus, onChange, onRename, onAddMember, onMember, onRemoveMember, onRemove }: ProjectCardProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  useEffect(() => {
    if (autoFocus) {
      nameRef.current?.focus();
      nameRef.current?.select();
    }
  }, [autoFocus]);
  const rates = project.rates ?? {};
  const setRates = (next: NonNullable<Project["rates"]>) => {
    const cleaned = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0)));
    onChange({ rates: Object.keys(cleaned).length > 0 ? cleaned : undefined });
  };
  const fixedLines = rates.fixedLines ?? [];
  const setFixed = (lines: FixedLine[]) => setRates({ ...rates, fixedLines: lines });
  const currency = rates.currency;
  const setCurrency = (code: string, perUsd: number | undefined) =>
    setRates({ ...rates, currency: code.trim() === "" && perUsd === undefined ? undefined : { code: code.trim().toUpperCase(), perUsd: perUsd ?? 0 } });
  const at = (suffix: string) => problems.filter((problem) => problem.path === `projects[${index}].${suffix}` || problem.path.startsWith(`projects[${index}].${suffix}.`) || problem.path.startsWith(`projects[${index}].${suffix}[`));
  const members = new Set(project.members.map((member) => member.repository));

  return (
    <Blueprint className="audit-section">
      <section aria-label={project.name.trim() === "" ? `Project ${index + 1}` : project.name} className="projects-card">
        <div className="projects-fields">
          <Field label="Name" id={`${baseId}-name`} problems={at("name")}>
            <input ref={nameRef} className="input" value={project.name} onChange={(event) => onRename(event.target.value)} {...fieldError(at("name"), `${baseId}-name`)} />
          </Field>
          <Field label="Client" id={`${baseId}-client`} problems={at("client")}>
            <input className="input" value={project.client ?? ""} onChange={(event) => onChange({ client: event.target.value })} />
          </Field>
          <Field label="Billing code" id={`${baseId}-code`} problems={at("billingCode")}>
            <input className="input" value={project.billingCode ?? ""} onChange={(event) => onChange({ billingCode: event.target.value })} />
          </Field>
          <Field label="Markup on statements, %" id={`${baseId}-markup`} problems={at("rates.markupPercent")}>
            <input
              className="input"
              type="number"
              min={0}
              value={rates.markupPercent ?? ""}
              onChange={(event) => setRates({ ...rates, markupPercent: numberOrUndefined(event.target.value) })}
              {...fieldError(at("rates.markupPercent"), `${baseId}-markup`)}
            />
          </Field>
        </div>

        <table className="table">
          <caption className="sr-only">Members of {project.name || `project ${index + 1}`}</caption>
          <thead>
            <tr>
              <th scope="col">Repository</th>
              <th scope="col">Path inside it</th>
              <th scope="col">Branches</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {project.members.map((member, memberIndex) => {
              const memberProblems = at(`members[${memberIndex}]`);
              const errorId = `${baseId}-member-${memberIndex}`;
              return (
                <tr key={memberIndex}>
                  <td>
                    <code>{repositoryLabel(member.repository)}</code>
                  </td>
                  <td>
                    <input className="input" aria-label="Path scope" placeholder="whole repository" value={member.path ?? ""} onChange={(event) => onMember(memberIndex, { path: event.target.value })} {...fieldError(memberProblems, errorId)} />
                  </td>
                  <td>
                    <input
                      className="input"
                      aria-label="Branch patterns"
                      placeholder="all branches"
                      defaultValue={branchesText(member)}
                      onChange={(event) => onMember(memberIndex, { branches: event.target.value })}
                      {...fieldError(memberProblems, errorId)}
                    />
                    <FieldErrors id={errorId} problems={memberProblems} />
                  </td>
                  <td>
                    <button type="button" className="btn btn-secondary" aria-label={`Remove ${repositoryLabel(member.repository)} from this project`} onClick={() => onRemoveMember(memberIndex)}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <FieldErrors id={`${baseId}-members`} problems={problems.filter((problem) => problem.path === `projects[${index}].members`)} />

        <div className="projects-row">
          <label className="field">
            <span>Add member</span>
            <select
              className="input"
              value=""
              onChange={(event) => {
                if (event.target.value) onAddMember(event.target.value);
              }}
            >
              <option value="">Choose a repository</option>
              {keys
                .filter((key) => !members.has(key))
                .map((key) => (
                  <option key={key} value={key}>
                    {repositoryLabel(key)}
                  </option>
                ))}
            </select>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={project.includeSubscriptionUse === true} onChange={(event) => onChange({ includeSubscriptionUse: event.target.checked || undefined })} />
            Include subscription use (API-equivalent) on statements
          </label>
        </div>

        <fieldset className="projects-rates">
          <legend>Fixed lines on every statement</legend>
          {fixedLines.map((line, lineIndex) => (
            <div key={lineIndex} className="projects-row">
              <input className="input" aria-label="Fixed line label" value={line.label} onChange={(event) => setFixed(fixedLines.map((l, i) => (i === lineIndex ? { ...l, label: event.target.value } : l)))} />
              <input
                className="input"
                type="number"
                min={0}
                aria-label="Fixed line amount"
                value={line.amount}
                onChange={(event) => setFixed(fixedLines.map((l, i) => (i === lineIndex ? { ...l, amount: Number(event.target.value) } : l)))}
              />
              <select className="input" aria-label="Fixed line currency" value={line.currency} onChange={(event) => setFixed(fixedLines.map((l, i) => (i === lineIndex ? { ...l, currency: event.target.value as FixedLine["currency"] } : l)))}>
                <option value="USD">USD</option>
                <option value="AI_CREDITS">AI Credits</option>
              </select>
              <button type="button" className="btn btn-secondary" aria-label={`Remove fixed line ${lineIndex + 1}`} onClick={() => setFixed(fixedLines.filter((_, i) => i !== lineIndex))}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-secondary" onClick={() => setFixed([...fixedLines, { label: "", amount: 0, currency: "USD" }])}>
            Add fixed line
          </button>
          <FieldErrors id={`${baseId}-fixed`} problems={at("rates.fixedLines")} />
        </fieldset>

        <fieldset className="projects-rates">
          <legend>Own currency on statements, at a fixed rate</legend>
          <div className="projects-row">
            <input className="input" aria-label="Own currency code" placeholder="e.g. EUR" maxLength={3} value={currency?.code ?? ""} onChange={(event) => setCurrency(event.target.value, currency?.perUsd)} />
            <input
              className="input"
              type="number"
              min={0}
              step="any"
              aria-label={`${currency?.code || "Currency"} per USD`}
              value={currency?.perUsd || ""}
              onChange={(event) => setCurrency(currency?.code ?? "", numberOrUndefined(event.target.value))}
            />
          </div>
          <FieldErrors id={`${baseId}-currency`} problems={at("rates.currency")} />
        </fieldset>

        <button type="button" className="btn btn-secondary" onClick={onRemove}>
          Remove project
        </button>
      </section>
    </Blueprint>
  );
}

function Field({ label, id, problems, children }: { label: string; id: string; problems: readonly ProjectFileProblem[]; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      <FieldErrors id={id} problems={problems} />
    </label>
  );
}
