import { useState, type FormEvent } from "react";

import { addCustomer } from "../../lib/reviews.server";
import { DashButton, DashInput, DashPanel, DashText } from "./primitives";

// "Add a customer" form. Behavior is unchanged from the original dashboard:
// the review request goes out the moment it is saved, and the customer's
// consent must be confirmed first.
export function AddCustomerPanel({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setIsError(false);

    if (!name.trim() || (!phone.trim() && !email.trim())) {
      setMessage("Add a name plus a phone number or email.");
      setIsError(true);
      return;
    }

    if (!consentConfirmed) {
      setMessage(
        "Please confirm the customer agreed to be contacted before sending.",
      );
      setIsError(true);
      return;
    }

    setSubmitting(true);
    try {
      const result = await addCustomer({
        data: { name, phone: phone || undefined, email: email || undefined },
      });
      if (result.ok) {
        const parts: string[] = [];
        if (result.smsSent === true) parts.push("text sent");
        if (result.smsSent === false) parts.push("text failed");
        if (result.smsHeld)
          parts.push("text will go out after 10am (quiet hours)");
        if (result.emailSent === true) parts.push("email sent");
        if (result.emailSent === false) parts.push("email failed");
        setMessage(
          parts.length > 0
            ? `Added. ${capitalize(parts.join(", "))}.`
            : "Added.",
        );
        setName("");
        setPhone("");
        setEmail("");
        setConsentConfirmed(false);
        onAdded();
      } else {
        setMessage(result.message);
        setIsError(true);
      }
    } catch (err) {
      console.error(err);
      setMessage("Something went wrong. Please try again.");
      setIsError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DashPanel title="Add a customer">
      <DashText>
        Their review request goes out the moment you save this. No extra step.
      </DashText>
      <form className="dash-add-form" onSubmit={handleSubmit}>
        <DashInput
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Customer name"
          aria-label="Customer name"
          required
        />
        <DashInput
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="Phone (optional)"
          aria-label="Phone"
        />
        <DashInput
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email (optional)"
          aria-label="Email"
        />
        <DashButton type="submit" variant="primary" disabled={submitting}>
          {submitting ? "Sending..." : "Add + send"}
        </DashButton>
        <label className="dash-consent">
          <input
            type="checkbox"
            checked={consentConfirmed}
            onChange={(event) => setConsentConfirmed(event.target.checked)}
            required
          />
          <span>
            I confirm this customer gave me their contact info and agreed to
            receive a one-time text or email from my business asking for a
            Google review, plus one reminder if they don't respond. Msg &amp;
            data rates may apply. Reply STOP to opt out, HELP for help. See our{" "}
            <a href="/privacy" target="_blank" rel="noreferrer">
              Privacy Policy
            </a>{" "}
            and{" "}
            <a href="/terms" target="_blank" rel="noreferrer">
              Terms
            </a>
            .
          </span>
        </label>
      </form>
      {message ? (
        <p
          className={
            isError
              ? "dash-form-message dash-form-message-error"
              : "dash-form-message"
          }
        >
          {message}
        </p>
      ) : null}
    </DashPanel>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
