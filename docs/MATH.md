# Mathematical Foundation

The selection, generation, and weight-update mechanics are governed by explicit thresholds so the synthetic dataset improves the target model instead of degrading it (model collapse).

## 1. Discriminative reward gap

Let `T` be a generated UI task, `C` the visual-functional execution log (screenshots + DOM traces from the Antigravity audit), and `K` the graded criteria. For a model `M`:

```
S(M, T, C) = (1/K) · Σ_{i=1..K} w_i · 𝟙(criterion i passes under M)
```

`w_i` = normalized criterion weight; `𝟙` = indicator. The **training utility** of an example is the strong/weak separation:

```
𝒰(T) = S(M_strong, T, C) − S(M_weak, T, C)
```

A pair is committed **iff**:

```
𝒰(T) ≥ τ ,   τ ∈ [0.4, 1.0]
```

In practice: the weak model (Gemma 4) must **fail** the visual audit and the strong model (Gemini 3.1 Pro) fix must **pass** it. If the weak model already passes, the example yields no learning signal and is discarded (`pair_rejected: too_easy`).

## 2. LoRA forward pass

During Prime Intellect fine-tuning the pre-trained weights `W₀ ∈ ℝ^{d×k}` of Gemma 4's attention layers are **frozen**. The update `ΔW` is factored into two low-rank matrices `A ∈ ℝ^{r×k}`, `B ∈ ℝ^{d×r}`, `r ≪ min(d,k)`:

```
h = W₀x + ΔWx = W₀x + (α/r) · B A x
```

`α` = scaling hyperparameter. Restricting gradients to `A`, `B` cuts memory overhead ~70%, preventing general-knowledge erasure while encoding the specific UI error-correction patterns. Config: `r = 16`, `α = 32`, target modules `q_proj, v_proj, k_proj, o_proj`, 3 epochs.

## 3. Data diversity / entropy filter

To stop the Challenger from spamming variations of one failure, compare the new failure embedding `E_new` against the last `N` committed failures by cosine similarity:

```
Sim(E_new, E_j) = (E_new · E_j) / (‖E_new‖ ‖E_j‖)
```

If `Sim(E_new, E_j) > 0.82` for **any** recent item, reject as redundant (`pair_rejected: redundant`) and force the Challenger to mutate its prompt toward a distinct engineering constraint.

## 4. Recipe mutation cadence

If the target model fails the **same design principle three times consecutively**, the Recipe Synthesizer mutates the `GenerationConfig` to focus exclusively on that UI mechanism for the next ~50 generations. Routine mutation also fires every `N` committed pairs (`recipe_mutated`).
