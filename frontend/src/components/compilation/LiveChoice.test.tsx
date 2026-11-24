import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import i18n from "i18next";
import "../../lib/i18n";
import LiveChoice from "./LiveChoice";

const lives = [
  { job: "home", label: "1 · 12 nov. · Maurice en cérémonie" },
  { job: "other", label: "2 · 9 nov. · La garde de nuit" },
];

describe("the live a tool works in", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("fr");
  });

  it("lists the lives the video takes from and changes to the one chosen", () => {
    const onChange = vi.fn();
    render(<LiveChoice lives={lives} value="home" onChange={onChange} label="Live à parcourir" />);
    const list = screen.getByRole("combobox", { name: "Live à parcourir" }) as HTMLSelectElement;
    expect([...list.options].map((option) => option.text)).toEqual(lives.map((live) => live.label));
    fireEvent.change(list, { target: { value: "other" } });
    expect(onChange).toHaveBeenCalledWith("other");
  });

  it("asks for one more live from its last line, and stays on the live it was on meanwhile", () => {
    const onChange = vi.fn();
    const onOther = vi.fn();
    render(<LiveChoice lives={lives.slice(0, 1)} value="home" onChange={onChange} onOther={onOther} label="Chercher dans" prefix="Chercher dans" />);
    const list = screen.getByRole("combobox", { name: "Chercher dans" }) as HTMLSelectElement;
    expect([...list.options].map((option) => option.text)).toEqual(["Chercher dans : 1 · 12 nov. · Maurice en cérémonie", "Un autre live…"]);
    fireEvent.change(list, { target: { value: list.options[1].value } });
    expect(onOther).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(list.value).toBe("home");
  });

  it("shows nothing when there is one live and no other can be added", () => {
    const { container } = render(<LiveChoice lives={lives.slice(0, 1)} value="home" onChange={vi.fn()} label="Live à parcourir" />);
    expect(container).toBeEmptyDOMElement();
  });
});
