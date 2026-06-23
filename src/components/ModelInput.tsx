"use client";

import { useEffect, useState } from "react";
import { api } from "@/components/client";

// Module-level cache so we fetch the model list once per page session.
let cache: string[] | null = null;

export function ModelInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [models, setModels] = useState<string[]>(cache ?? []);

  useEffect(() => {
    if (cache) return;
    api
      .get("/api/models")
      .then((m: string[]) => {
        cache = m;
        setModels(m);
      })
      .catch(() => {});
  }, []);

  return (
    <>
      <input
        className="input"
        list="leo-models"
        value={value}
        placeholder={placeholder ?? "elige o escribe un modelo"}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id="leo-models">
        {models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </>
  );
}
