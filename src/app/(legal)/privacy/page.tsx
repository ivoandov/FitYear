import type { Metadata } from "next";
import { LegalPage } from "../legal";

export const metadata: Metadata = {
  title: "Privacy Policy - FitYear",
  description: "What FitYear stores, why, and how to delete it.",
};

/**
 * Written to be true rather than to be thorough. Everything listed here was
 * checked against the schema and the code that calls out to other services; if
 * a feature changes what it stores, this page changes with it.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="2 September 2026">
      <p>
        FitYear is a workout tracker built and run by Ivo Andov. It is a small
        product, not an advertising business: nothing here is sold, and nothing
        is used to track you across other apps or websites.
      </p>

      <h2>What is stored</h2>
      <ul>
        <li>
          <strong>Your account.</strong> Your email address and name come from
          the sign-in provider you choose (Google or Apple). If you use Sign in
          with Apple and hide your email, we only ever see the relay address
          Apple gives us.
        </li>
        <li>
          <strong>Your training.</strong> Workouts, exercises, sets, weights,
          reps, durations, personal records, routines, schedules and the
          settings you pick.
        </li>
        <li>
          <strong>Your timezone</strong>, so a workout lands on the day you
          actually did it.
        </li>
        <li>
          <strong>Google Calendar tokens</strong>, only if you connect a
          calendar. They are encrypted at rest and are used solely to create and
          update your own workout events. Disconnecting deletes them.
        </li>
        <li>
          <strong>A push subscription</strong>, only if you turn on rest alerts,
          so your phone can be told a rest has finished.
        </li>
      </ul>

      <h2>Who else sees it</h2>
      <p>
        Only the services needed to run the app, and only the part each one
        needs:
      </p>
      <ul>
        <li>
          <strong>Supabase</strong> hosts the database and handles sign-in.
        </li>
        <li>
          <strong>Vercel</strong> runs the app and collects anonymous
          performance data.
        </li>
        <li>
          <strong>Anthropic</strong> and <strong>Google</strong> receive the
          text of a request when you use FitBot or import a plan, so they can
          write it. That text is your prompt and the relevant exercise names,
          not your whole history.
        </li>
        <li>
          <strong>Google Cloud</strong> stores exercise images.
        </li>
        <li>
          <strong>Sentry</strong> receives crash reports so bugs get fixed. They
          are scrubbed of personal detail.
        </li>
        <li>
          <strong>Apple</strong> delivers push notifications to iPhones.
        </li>
      </ul>
      <p>
        Your data is not sold, rented, or shared with anyone else. There is no
        advertising and no cross-app tracking.
      </p>

      <h2>Deleting everything</h2>
      <p>
        Open <strong>Settings</strong> and choose{" "}
        <strong>Delete account</strong>. It happens immediately and cannot be
        undone: your workouts, history, routines, schedules, settings, calendar
        connection and push subscriptions are all removed.
      </p>
      <p>
        One deliberate exception. FitYear has a single shared exercise library
        that everyone picks from. If you added an exercise to it, that entry
        stays in the library with your name removed from it, so other people&apos;s
        workouts do not break. Your own training data is still deleted in full.
      </p>

      <h2>Children</h2>
      <p>FitYear is not directed at children under 13.</p>

      <h2>Changes</h2>
      <p>
        If this policy changes in a way that matters, the date at the top
        changes with it.
      </p>
    </LegalPage>
  );
}
