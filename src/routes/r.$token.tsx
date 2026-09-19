import { createFileRoute, redirect } from "@tanstack/react-router";

import { resolveReviewRedirect } from "../lib/reviews.server";

// The link every text/email points at. Visiting it records the click (our
// real signal that a customer engaged) and then bounces straight to the
// business's Google review page.
export const Route = createFileRoute("/r/$token")({
  loader: async ({ params }) => {
    const { url } = await resolveReviewRedirect({ data: { token: params.token } });
    throw redirect({ href: url });
  },
  component: () => null,
});
