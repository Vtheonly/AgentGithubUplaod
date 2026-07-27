/**
 * ComingSoonCard — standardized "module scaffolded, full implementation
 * arrives in a later iteration" message.
 *
 * Used for stubbed hubs/tabs that have correct structure but no deep
 * workflows yet.
 */
import { Construction } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card";

export function ComingSoonCard({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  const { t } = useTranslation();
  return (
    <Card className="border-dashed">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-status-warning/15">
            <Construction className="h-5 w-5 text-status-warning" />
          </div>
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>{t("comingSoon.title")}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {description ?? t("comingSoon.description")}
        </p>
      </CardContent>
    </Card>
  );
}
