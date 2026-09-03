import type { Metadata } from "next";
import { LegalPage } from "../legal";

export const metadata: Metadata = {
  title: "Support - FitYear",
  description: "How to get help with FitYear.",
};

/**
 * Exists because Apple requires a support URL where a user can reach a human,
 * and the terms page is not that. Deliberately short: a support page that
 * buries an email address under a FAQ nobody wrote is worse than one that just
 * gives you the address.
 */
export default function SupportPage() {
  return (
    <LegalPage title="Support" updated="3 September 2026">
      <p>
        FitYear is built and run by one person. There is no ticket queue and no
        bot: email <a href="mailto:ivo@flyhi.ai">ivo@flyhi.ai</a> and you will
        get a reply from me.
      </p>

      <h2>What helps me fix it faster</h2>
      <ul>
        <li>What you were doing when it went wrong.</li>
        <li>
          Whether you were on the iPhone app or the website, since a few things
          (rest alerts, the lock-screen timer) only exist in the app.
        </li>
        <li>
          A screenshot, if there was something on screen worth seeing.
        </li>
      </ul>

      <h2>Things you can do without me</h2>
      <ul>
        <li>
          <strong>Rest alerts are not arriving.</strong> Check that
          notifications are allowed for FitYear in your phone&apos;s Settings.
          The alert is sent when the rest ends, so it needs permission granted
          before the rest starts, not after.
        </li>
        <li>
          <strong>The lock-screen rest timer is missing.</strong> Live
          Activities can be turned off per app in Settings. It also needs iOS
          16.2 or later.
        </li>
        <li>
          <strong>A workout is recorded with the wrong duration.</strong>
          Forgetting to press Finish logs the idle time as training. You can
          edit the duration on the workout in History.
        </li>
        <li>
          <strong>You want your account gone.</strong> Settings has a Delete
          account button. It is immediate and it takes everything with it, so
          there is nothing to email me about first.
        </li>
      </ul>

      <h2>Privacy and terms</h2>
      <p>
        What is stored and why is on the{" "}
        <a href="/privacy">privacy policy</a>, and the{" "}
        <a href="/terms">terms</a> are the short version of the deal.
      </p>
    </LegalPage>
  );
}
