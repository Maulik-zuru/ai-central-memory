"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Password-reset delivery (email + token flow) is not part of the Phase 1 backend surface —
// see docs/Phase1_Implementation_Plan.md §2. This screen exists so the nav link from Login
// doesn't dead-end; wiring it to a real endpoint is a follow-up, not a Phase 1 blocker.
export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>
          {submitted
            ? "If that email exists, a reset link is on its way."
            : "Enter your email and we'll send you a reset link."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!submitted ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(true);
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" required />
            </div>
            <Button type="submit">Send reset link</Button>
          </form>
        ) : null}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/login" className="text-primary underline underline-offset-4">
            Back to log in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
