# Creative workflows

This guide is for creators who refine media across several runs in Graph Studio.
Studio reads node contracts from your executor and keeps execution in `mere.run`.

## Reuse a result

On a completed node output, select **Use as input**. Studio saves the result to
the comparison board and creates a graph input card. Connect that card to a
compatible input on another node to branch or refine the result.

Desktop Studio copies only an artifact declared by the run into the workspace.
Hosted Studio stores an account-scoped run artifact reference. Before submitting
another run, it downloads the artifact, computes its SHA-256, creates a portable
asset manifest, and uploads missing hashes through Relay's create/upload/commit
contract. The original run must remain available to reuse a hosted reference.

## Compare saved outputs

Select **Save to board** on a completed media output. In the **Board** tab,
select **Compare** on two cards to review their media, model, seed, and run IDs.
Select **Show all** to return to the full board.

The board holds up to 100 artifact references in the editor sidecar. It survives
project save, reload, import, and export. It stores no media bytes or prompt
values. An unavailable artifact remains visible as an unavailable card.
Removing a card does not delete the run or its artifacts.

## Save reusable nodes

Select a node or a connected group, then select **Save preset**. Give it a name.
In the library's **Saved** tab, select the preset or drag it onto the canvas.
Studio assigns fresh node IDs, remaps internal references and dependencies,
and preserves relative positions. A preset with several nodes creates a group.

Include every source node and ordering dependency in the selection. External
graph input references must be disconnected before saving. Presets store named
secret references and reject credential values. The preset library is local to
this browser or desktop profile and holds up to 100 presets.

## Finish images

Install `mere-image-compose` on the executor through the official plugin
installation flow. Its public provider catalog supplies four image nodes:

| Node | Operation |
| --- | --- |
| `image.crop` | Crop to an exact pixel rectangle. |
| `image.mask` | Apply a grayscale mask to image transparency. |
| `image.composite` | Place an overlay on a base with position and opacity. |
| `image.inpaint` | Fill a small masked defect from neighboring pixels. |

The inpaint operation is deterministic neighborhood filling. It does not run a
generative model or accept a prompt. It supports images up to four megapixels
and masks covering at most 25% of the image. Other operations support images up
to 16 megapixels. All four return PNG assets through the public provider API.

## Publish an app version

In hosted Studio, expose at least one graph output, save the project, and open
the **App** tab. Select **Share app**, then **Publish new version**. Copy the
version's link. Viewers sign in and run the snapshot on their own paired fleet.

Each link identifies an immutable snapshot of the graph, input values, and App
presentation. Later edits do not change that version. Anyone with the link can
read those documents. The snapshot excludes board cards, notes, selections, and
canvas positions. Select **Revoke** to make a version unavailable.

Hosted publication rejects asset inputs because a viewer cannot read the
publisher's account-scoped run artifacts. Desktop sharing exports a portable
`.meregraph.json` project package.
