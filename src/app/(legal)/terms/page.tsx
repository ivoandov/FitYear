import type { Metadata } from "next";
import { LegalPage } from "../legal";

export const metadata: Metadata = {
  title: "Terms of Use - FitYear",
  description: "The terms for using FitYear.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use" updated="2 September 2026">
      <p>
        FitYear is a workout tracker built and run by Ivo Andov. Using it means
        agreeing to what follows. It is written plainly on purpose.
      </p>

      <h2>This is not medical advice</h2>
      <p>
        FitYear records the training you tell it about, and its AI features
        suggest workouts and programs. None of that is medical, physiotherapy or
        professional coaching advice. Exercise carries a risk of injury. Use your
        own judgement, train within your ability, and talk to a doctor before
        starting something new, especially if you have an existing condition or
        injury. You are responsible for what you choose to lift.
      </p>

      <h2>AI features</h2>
      <p>
        FitBot and the plan importer use AI, so they are sometimes wrong. Treat
        what they produce as a draft to check, not a prescription. Weights, rep
        counts and progressions in particular deserve a sanity check before you
        act on them.
      </p>

      <h2>Your account</h2>
      <p>
        Keep your sign-in secure, and do not use someone else&apos;s account.
        Deliberately abusing the service - trying to reach other people&apos;s
        data, hammering the AI features, or breaking the app for others - means
        the account can be closed.
      </p>

      <h2>Your data</h2>
      <p>
        Your training data is yours. What is stored and how to delete all of it
        is set out in the <a href="/privacy">Privacy Policy</a>. Exercises you
        add to the shared library stay in that library with your name removed, so
        other people&apos;s workouts keep working.
      </p>

      <h2>Availability</h2>
      <p>
        FitYear is provided as it is, without a guarantee that it will always be
        available or free of bugs. It is backed up, but keep your own record of
        anything you would be upset to lose. To the extent the law allows,
        liability is limited to what you have paid to use it.
      </p>

      <h2>Changes</h2>
      <p>
        These terms may change; the date at the top will say when. Continuing to
        use FitYear after a change means accepting it.
      </p>
    </LegalPage>
  );
}
