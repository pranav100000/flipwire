import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getConfig } from "@/config";
import { readOperatorSessionToken, SESSION_COOKIE } from "@/lib/auth";

export const requireOperatorSession = async () => {
  const config = getConfig();
  const cookieStore = await cookies();
  const session = readOperatorSessionToken(cookieStore.get(SESSION_COOKIE)?.value, config.secretKey);
  if (!session) redirect("/login");
  return session;
};
