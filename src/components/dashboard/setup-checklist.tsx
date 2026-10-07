import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { updateGoogleReviewUrl } from "../../lib/reviews.server";
import { IconAlert } from "./icons";
import { dashButtonClass } from "./format";
import { DashButton, DashInput } from "./primitives";
import type { SetupTodo } from "./types";

function ReviewLinkForm({ onSaved }: { onSaved: () => void }) {
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const result = await updateGoogleReviewUrl({
        data: { googleReviewUrl: url },
      });
      if (result.ok) {
        onSaved();
      } else {
        setMessage(result.message ?? "Could not save.");
      }
    } catch (err) {
      console.error(err);
      setMessage("Could not save. Check the link and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="dash-todo-form" onSubmit={handleSave}>
      <DashInput
        type="url"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="https://g.page/r/your-business/review"
        aria-label="Your Google review link"
        required
      />
      <DashButton type="submit" variant="primary" disabled={saving}>
        {saving ? "Saving..." : "Save link"}
      </DashButton>
      {message ? <p className="dash-todo-message">{message}</p> : null}
    </form>
  );
}

function TodoAction({
  todo,
  onChanged,
}: {
  todo: SetupTodo;
  onChanged: () => void;
}) {
  switch (todo.id) {
    case "review-link":
      return <ReviewLinkForm onSaved={onChanged} />;
    case "crm":
      return (
        <div className="dash-todo-actions">
          <DashButton href="/connect/square/start" variant="ghost" size="sm">
            Connect Square
          </DashButton>
          <DashButton href="/connect/jobber/start" variant="ghost" size="sm">
            Connect Jobber
          </DashButton>
        </div>
      );
    case "google":
      return (
        <div className="dash-todo-actions">
          <DashButton href="/connect/google/start" variant="ghost" size="sm">
            Connect Google
          </DashButton>
        </div>
      );
    case "reconnect-square":
      return (
        <div className="dash-todo-actions">
          <DashButton href="/connect/square/start" variant="ghost" size="sm">
            Reconnect Square
          </DashButton>
        </div>
      );
    case "reconnect-jobber":
      return (
        <div className="dash-todo-actions">
          <DashButton href="/connect/jobber/start" variant="ghost" size="sm">
            Reconnect Jobber
          </DashButton>
        </div>
      );
    case "reconnect-google":
      return (
        <div className="dash-todo-actions">
          <DashButton href="/connect/google/start" variant="ghost" size="sm">
            Reconnect Google
          </DashButton>
        </div>
      );
    case "google-location":
      return (
        <div className="dash-todo-actions">
          <Link
            to="/app"
            search={{ tab: "settings" }}
            className={dashButtonClass("ghost", "sm")}
          >
            Choose location
          </Link>
        </div>
      );
    case "sms":
      return null;
  }
}

// Shown on Overview while something is blocking or limiting automation, most
// important first. It disappears by itself once everything is done.
export function DashSetupChecklist({
  todos,
  onChanged,
}: {
  todos: SetupTodo[];
  onChanged: () => void;
}) {
  if (todos.length === 0) return null;
  const blocking = todos.some((todo) => todo.blocking);

  return (
    <section
      className="dash-setup"
      id="dash-setup"
      aria-labelledby="dash-setup-title"
    >
      <div className="dash-setup-head">
        <span className="dash-setup-icon" aria-hidden="true">
          <IconAlert size={15} />
        </span>
        <div>
          <h2 id="dash-setup-title">
            {blocking
              ? "Finish setup to start sending"
              : "A few more things to set up"}
          </h2>
          <p>
            {todos.length === 1
              ? "One thing left."
              : `${todos.length} things left.`}{" "}
            This goes away on its own when you are done.
          </p>
        </div>
      </div>
      <ol className="dash-todo-list">
        {todos.map((todo, index) => (
          <li className="dash-todo" key={todo.id}>
            <span className="dash-todo-num" aria-hidden="true">
              {index + 1}
            </span>
            <div className="dash-todo-body">
              <div className="dash-todo-title">{todo.title}</div>
              <div className="dash-todo-detail">{todo.detail}</div>
              <TodoAction todo={todo} onChanged={onChanged} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
