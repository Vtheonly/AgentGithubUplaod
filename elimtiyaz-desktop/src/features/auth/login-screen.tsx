/**
 * Login screen — email/password form.
 *
 * Staff authenticate against Supabase (or the mock layer in dev mode when
 * Supabase is not configured). Parent/Student emails trigger a redirect
 * message to the Web Portal (per plan §02.07).
 *
 * SECURITY (SEC-100, task T-001): this screen previously shipped a
 * DEMO_ACCOUNTS array with nine staff email/password pairs as quick-fill
 * buttons — the literals ended up in the production bundle. The array was
 * removed; demo-account policy is tracked as UNKNOWN-009. Do NOT reintroduce
 * credential literals here.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LogIn } from "lucide-react";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../shared/ui/card";
import { ParticleCanvas } from "../../shared/ui/particle-canvas";

export function LoginScreen() {
  const { t } = useTranslation();
  const { signIn, isLoading } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = await signIn(email, password);
    if (!result.ok) {
      toast.showError(t("auth.invalidCredentials"), result.error);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-background p-6">
      <div className="grid grid-cols-1 w-full max-w-5xl gap-8 lg:grid-cols-[1fr_400px]">
        {/* Brand panel */}
        <div className="hidden lg:flex flex-col justify-between rounded-lg border border-border bg-surface-panel p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary text-primary-foreground text-xl font-bold">
              EI
            </div>
            <div>
              <p className="text-lg font-semibold text-foreground">El-Imtiyaz</p>
              <p className="text-xs text-muted-foreground">Plateforme de gestion scolaire</p>
            </div>
          </div>

          <div className="h-[50vh] -mx-4">
            {/*
              Brand side-panel decoration — uses the new ParticleCanvas
              wrapper around the renderer-side ParticleEngine. Particles
              form the EI monogram and react to the cursor.
            */}
            <ParticleCanvas mode="logo" density={3} fillRatio={0.7} />
          </div>

          <p className="text-xs text-muted-foreground">
             {new Date().getFullYear()} El-Imtiyaz. Tous droits réservés.
          </p>
        </div>

        {/* Login form */}
        <Card className="border-border bg-surface-panel">
          <CardHeader>
            <CardTitle className="text-xl">{t("auth.title")}</CardTitle>
            <CardDescription>{t("auth.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t("auth.email")}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@elimtiyaz.dz"
                  required
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{t("auth.password")}</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
              </div>
              <Button type="submit" disabled={isLoading} className="w-full">
                <LogIn className="h-4 w-4" />
                {isLoading ? t("auth.signingIn") : t("auth.signIn")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
