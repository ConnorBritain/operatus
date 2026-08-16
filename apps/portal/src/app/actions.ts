"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const branchThemes = ["cedar", "harbor", "saffron", "juniper", "clay", "iris", "moss", "ember", "coast", "orchid", "slate", "sol"] as const;

function textField(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

async function authenticated() {
  const result = await requireUser();
  if (!result.userId) redirect("/");
  return result;
}

export async function saveProfile(formData: FormData) {
  const { userId, supabase } = await authenticated();
  const parsed = z.string().min(1).max(120).safeParse(textField(formData, "displayName"));
  if (!parsed.success) redirect("/settings?notice=profile-invalid");

  const { error } = await supabase.from("profiles").update({ display_name: parsed.data }).eq("user_id", userId);
  if (error) redirect("/settings?notice=save-failed");
  revalidatePath("/");
  revalidatePath("/settings");
  redirect("/settings?notice=profile-saved");
}

export async function savePreferences(formData: FormData) {
  const { userId, supabase } = await authenticated();
  const parsed = z.object({
    appearance: z.enum(["system", "light", "dark"]),
    avatarTheme: z.enum(branchThemes),
    machineScope: z.enum(["all", "online", "favorites"]),
    density: z.enum(["comfortable", "compact"]),
  }).safeParse({
    appearance: textField(formData, "appearance"),
    avatarTheme: textField(formData, "avatarTheme"),
    machineScope: textField(formData, "machineScope"),
    density: textField(formData, "density"),
  });
  if (!parsed.success) redirect("/settings?notice=preferences-invalid");

  const { error } = await supabase.from("user_preferences").upsert({
    user_id: userId,
    appearance: parsed.data.appearance,
    avatar_theme: parsed.data.avatarTheme,
    machine_scope: parsed.data.machineScope,
    density: parsed.data.density,
  }, { onConflict: "user_id" });
  if (error) redirect("/settings?notice=save-failed");
  revalidatePath("/");
  revalidatePath("/settings");
  redirect("/settings?notice=preferences-saved");
}

export async function saveWorkspace(formData: FormData) {
  const { supabase } = await authenticated();
  const parsed = z.object({
    workspaceId: z.string().uuid(),
    name: z.string().min(1).max(120),
  }).safeParse({ workspaceId: textField(formData, "workspaceId"), name: textField(formData, "name") });
  if (!parsed.success) redirect("/settings?notice=workspace-invalid");

  const { error } = await supabase.from("workspaces").update({ name: parsed.data.name }).eq("id", parsed.data.workspaceId);
  if (error) redirect("/settings?notice=save-failed");
  revalidatePath("/");
  revalidatePath("/settings");
  redirect("/settings?notice=workspace-saved");
}

export async function saveBranch(formData: FormData) {
  const { supabase } = await authenticated();
  const parsed = z.object({
    branchId: z.string().uuid(),
    name: z.string().min(1).max(80),
    theme: z.enum(branchThemes),
  }).safeParse({
    branchId: textField(formData, "branchId"),
    name: textField(formData, "name"),
    theme: textField(formData, "theme"),
  });
  if (!parsed.success) redirect("/settings?notice=branch-invalid");

  const { error } = await supabase.from("branches").update({ name: parsed.data.name, theme: parsed.data.theme }).eq("id", parsed.data.branchId);
  if (error) redirect("/settings?notice=save-failed");
  revalidatePath("/");
  revalidatePath("/settings");
  redirect("/settings?notice=machine-saved");
}

export async function toggleFavorite(formData: FormData) {
  const { userId, supabase } = await authenticated();
  const parsed = z.object({
    branchId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    favorite: z.enum(["true", "false"]).transform((value) => value === "true"),
  }).safeParse({
    branchId: textField(formData, "branchId"),
    workspaceId: textField(formData, "workspaceId"),
    favorite: textField(formData, "favorite"),
  });
  if (!parsed.success) redirect("/?notice=favorite-invalid");

  const { error } = await supabase.from("branch_preferences").upsert({
    user_id: userId,
    branch_id: parsed.data.branchId,
    workspace_id: parsed.data.workspaceId,
    favorite: parsed.data.favorite,
  }, { onConflict: "user_id,branch_id" });
  if (error) redirect("/?notice=favorite-failed");
  revalidatePath("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
