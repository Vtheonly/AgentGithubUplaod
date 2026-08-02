/**
 * Login screen — email/password form with role picker for demo accounts.
 *
 * Mirrors the Android app's pattern: 4 demo staff accounts (SuperAdmin /
 * FinOfficer / Teacher / Support) shown as quick-fill chips. Parent/Student
 * emails trigger a redirect message to the Web Portal (per plan §02.07).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LogIn, Shield, Wallet, GraduationCap, LifeBuoy, Users, ShoppingCart, Truck, Package, HardHat } from "lucide-react";
import { useAuth } from "../../app/providers/auth-provider";
import { useToast } from "../../app/providers/toast-provider";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../shared/ui/card";
import { cn } from "../../shared/ui/cn";
import { ParticleCanvas } from "../../shared/ui/particle-canvas";




// ggignore
const DEMO_ACCOUNTS = [
  { email: "admin@elimtiyaz.dz", password: "admin123", role: "Super Administrateur", icon: Shield, color: "text-primary" },
  { email: "financial@elimtiyaz.dz", password: "fin123", role: "Agent Financier", icon: Wallet, color: "text-status-success" },
  { email: "teacher@elimtiyaz.dz", password: "teach123", role: "Enseignant", icon: GraduationCap, color: "text-status-warning" },
  { email: "support@elimtiyaz.dz", password: "support123", role: "Personnel de Soutien", icon: LifeBuoy, color: "text-status-info" },
  { email: "manager@elimtiyaz.dz", password: "manager123", role: "Responsable", icon: Users, color: "text-primary" },
  { email: "buyer@elimtiyaz.dz", password: "buyer123", role: "Acheteur", icon: ShoppingCart, color: "text-status-info" },
  { email: "driver@elimtiyaz.dz", password: "driver123", role: "Chauffeur", icon: Truck, color: "text-brand-brown" },
  { email: "warehouse@elimtiyaz.dz", password: "warehouse123", role: "Magasinier", icon: Package, color: "text-status-success" },
  { email: "worker@elimtiyaz.dz", password: "worker123", role: "Ouvrier", icon: HardHat, color: "text-brand-slate" },
];

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

  function fillDemo(acc: (typeof DEMO_ACCOUNTS)[number]) {
    setEmail(acc.email);
    setPassword(acc.password);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#242526] p-6">
      <div className="grid w-full max-w-5xl gap-8 lg:grid-cols-[1fr_400px]">
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

            <div className="mt-6 pt-4 border-t border-border">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
                {t("auth.demoAccounts")}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {DEMO_ACCOUNTS.map((acc) => {
                  const Icon = acc.icon;
                  return (
                    <button
                      key={acc.email}
                      type="button"
                      onClick={() => fillDemo(acc)}
                      className={cn(
                        "flex flex-col items-start gap-1 rounded-md border border-border p-2 text-left transition-colors hover:border-primary hover:bg-primary/5",
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <Icon className={cn("h-3.5 w-3.5", acc.color)} />
                        <span className="text-xs font-medium text-foreground">{acc.role}</span>
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground truncate w-full">
                        {acc.email}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
