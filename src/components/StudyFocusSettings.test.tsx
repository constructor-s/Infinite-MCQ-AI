import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudyFocusSettings } from "./StudyFocusSettings";

afterEach(cleanup);

describe("StudyFocusSettings", () => {
  it("searches eligible topics, applies explicitly, and resets the topic on discipline changes", async () => {
    const onApply = vi.fn(async () => undefined);
    render(<StudyFocusSettings focus={null} onApply={onApply} />);
    expect(screen.getByLabelText("Practice")).toHaveValue("mixed");
    expect(screen.getByRole("button", { name: "Apply focus" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Practice"), { target: { value: "focused" } });
    fireEvent.change(screen.getByLabelText("Search MCC topics"), { target: { value: "CHEST PAIN" } });
    const topics = screen.getByLabelText("MCC topic");
    expect(within(topics).getAllByRole("option").map((option) => option.textContent)).toEqual(["All topics", "Chest pain"]);
    fireEvent.change(topics, { target: { value: "14" } });
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply focus" }));
    await waitFor(() => expect(onApply).toHaveBeenCalledExactlyOnceWith({ discipline: "medicine", objectiveId: "14" }));
    expect(await screen.findByText(/Focus saved/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Discipline"), { target: { value: "pediatrics" } });
    expect(topics).toHaveValue("");
    expect(screen.getByLabelText("Search MCC topics")).toHaveValue("");
    expect(within(topics).queryByRole("option", { name: "Chest pain" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search MCC topics"), { target: { value: "no such objective" } });
    expect(screen.getByText(/No matching topics/)).toBeInTheDocument();
  });

  it("keeps a failed save editable and can return to mixed practice", async () => {
    const onApply = vi.fn().mockRejectedValueOnce(new Error("Storage failed")).mockResolvedValue(undefined);
    render(<StudyFocusSettings focus={{ discipline: "medicine", objectiveId: "14" }} onApply={onApply} />);
    fireEvent.change(screen.getByLabelText("Practice"), { target: { value: "mixed" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply focus" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save question focus");
    expect(screen.getByRole("button", { name: "Apply focus" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Apply focus" }));
    await screen.findByText(/Focus saved/);
    expect(onApply).toHaveBeenLastCalledWith(null);
  });
});
