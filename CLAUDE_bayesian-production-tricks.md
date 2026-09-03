# Stan in Production

Reference for Claude. Two jobs: **write a competent Stan model**, and **make it fast enough
to run on a schedule**. Part 1 is correctness and idiom, Part 2 is performance. When a
technique belongs to both, it is stated in Part 1 and its speed consequence noted in Part 2.

Assumed context: a model that already fits and is already trusted, that now has to run on a
daily budget. Optimize in Part 2's order; do not start at the bottom.

**How to read the markers.** Claims carry their evidence, so you can tell what will rot and
what will not:

| Marker | Means |
|---|---|
| `[M]` | **Measured** — this number came from running it; see Provenance for the setup |
| `[C]` | **Compiles** — verified with `stanc` under the toolchain in Provenance |
| `[D]` | **Documented** — checked against library docs or source, *not executed* |
| `[L]` | **Literature** — from the cited reference |

Unmarked prose is general Stan practice with no single source. `[D]` is the weakest class and
the first to go stale — see Provenance for how to re-check everything.

---

# Part 1 — Writing Competent Stan

## Block structure, and what each block costs

The blocks are not just organization — they determine how often code runs and what gets
written to disk.

| Block | Runs | Written to output |
|---|---|---|
| `data` | once | no |
| `transformed data` | once | no |
| `parameters` | — | yes |
| `transformed parameters` | **every leapfrog step** | **yes, every draw** |
| `model` | every leapfrog step | no |
| `generated quantities` | once per saved draw | yes |

Two consequences worth internalizing:

- **Anything constant belongs in `transformed data`.** Computed once instead of millions of
  times. Standardizing predictors, building index arrays, precomputing `log(x)` — all free
  if hoisted.
- **`transformed parameters` is expensive twice over.** It is on the gradient path *and*
  every element is written to the CSV for every draw. If an intermediate is only needed to
  build the log density, declare it in a local block inside `model` instead:

```stan
model {
  profile("likelihood") {
    vector[N] eta = X * beta;   // local: on the gradient path, never written to disk
    y ~ bernoulli_logit(eta);
  }
}
```

A `matrix[K,K]` in `transformed parameters` with K=50 writes 2500 numbers per draw. At 4000
draws that is 10 million values you probably never read.

## Constraints and priors

**Declare the constraint; Stan handles the transform.** `real<lower=0> sigma` makes Stan
sample `log(sigma)` internally and apply the Jacobian for you. You do not need to do anything
else to get a well-behaved positive parameter.

**Stan has no `half_normal`.** This is a compile error, not a runtime surprise:

```text
Ill-typed arguments to "~"-statement. No function "half_normal_lpdf" was found
when looking for distribution "half_normal".
```
`[C]` — this is the literal `stanc` output, not a paraphrase.

A half-normal is a `<lower=0>` declaration plus `normal(0, s)`. Stan drops the truncation
constant, which does not affect sampling:

```stan
real<lower=0> sigma;
sigma ~ normal(0, 0.1);   // this is half-normal(0, 0.1)
```

**Sampling on the log scale is a prior choice, not a speed trick.** Since `<lower=0>` already
samples in log space, declaring `log_sigma` yourself changes only the prior shape:

```stan
data              { int<lower=1> K; }
parameters        { vector[K] log_sigma; }
transformed parameters { vector<lower=0>[K] sigma = exp(log_sigma); }
model             { log_sigma ~ normal(0, 0.5); }
// implied lognormal: median 1.00, mode 0.78, 90% interval [0.44, 2.28]   [M]
```

A half-normal has maximum density *at* zero; that lognormal has zero density there. Use the
log-scale form when you need to exclude `sigma = 0` — it rescues variance components that
would otherwise collapse. Scale it to your data; `normal(0, 0.5)` on the log scale is fairly
informative and centred on `sigma ≈ 1`.

## Non-centered parameterization

The standard fix for hierarchical funnels. Rather than sampling `theta ~ normal(mu, sigma)`
directly, sample a standard normal and rescale:

```stan
parameters        { real mu; real<lower=0> sigma; vector[K] z; }
transformed parameters { vector[K] theta = mu + sigma * z; }
model             { z ~ std_normal(); }
```

This decouples the prior geometry from the likelihood and removes most divergences when
`sigma` is small or weakly identified.

**It is not universally better.** Non-centered wins when the data are *weak* relative to the
prior — few observations per group, `sigma` near zero. Centered wins when the data are
*strong*: many observations per group pin each `theta` down, and the non-centered form then
induces a funnel of its own. Betancourt & Girolami (2015) work through both regimes `[L]`. With
uneven group sizes, fit both and compare divergences and ESS.

Coming from `brms` or `rstanarm`: they emit the non-centered form for you. Writing Stan by
hand, it is yours to remember.

## Correlation matrices

**Use the built-in.** It is correct, it carries its Jacobian, and its geometry is good:

```stan
data       { int<lower=1> K; }
parameters { cholesky_factor_corr[K] L; }
model      { L ~ lkj_corr_cholesky(4); }
```

You will sometimes see warmup messages like:

```text
Exception: lkj_corr_cholesky_lpdf: Random variable[7] is 0, but must be positive!
```

**These are usually harmless.** They come from the density, not the geometry:
`lkj_corr_cholesky_lpdf` evaluates `sum(log(diag(L)))`, and when a diagonal element underflows
to exactly 0 that term is `-inf` and the function throws. Measured at K=10, 4 chains,
1000+1000: 26 such warmup messages, and the fit still finished with **0 divergences,
R̂ = 1.00, Bulk-ESS ≈ 1700–2300** `[M]`. Judge the fit by sampling-phase divergences and R̂/ESS, not
by warmup message count.

Hand-rolling the transform buys **no geometric advantage** — Stan's `cholesky_factor_corr`
*is* the tanh + signed stick-breaking map `[L]` (`z = tanh(y)`, then
`x[i,j] = z[i,j] * sqrt(1 - sum_{j'<j} x[i,j']^2)`), so a hand-rolled version samples in
exactly the same space.

The one real reason to hand-roll is to put a prior directly on the unconstrained scale, which
sidesteps `lkj_corr_cholesky_lpdf` entirely. Do that only if warmup exceptions are frequent
enough that adaptation actually fails:

```stan
data { int<lower=1> K; }
transformed data { int n_corr = (K * (K - 1)) %/% 2; }   // note the outer parentheses
parameters { vector[n_corr] z_raw; }                      // exactly K(K-1)/2 values
transformed parameters {
  matrix[K, K] L = rep_matrix(0, K, K);                   // zero the upper triangle
  {
    int pos = 1;
    L[1, 1] = 1;
    for (i in 2:K) {
      real running_prod = 1.0;
      for (j in 1:(i - 1)) {
        real z = tanh(z_raw[pos]);
        pos += 1;
        L[i, j] = z * running_prod;
        running_prod *= sqrt(1.0 - z * z);
      }
      L[i, i] = running_prod;
    }
  }
}
model {
  z_raw ~ normal(0, 0.28);   // K-dependent; see the table
}
```

Three details are load-bearing, and each has bitten a real model:

- **`rep_matrix(0, K, K)`.** Stan neither initializes nor validates an unconstrained `matrix`
  in transformed parameters. Declare it bare, fill only the lower triangle, and the model
  *runs clean* while writing `nan` into every upper-triangle cell — 4500 of them in a
  600-draw K=6 fit `[M]`. A downstream `multi_normal_cholesky(mu, L)` then rejects every proposal.
  Silent wrong answers, not a crash.
- **`vector[n_corr]`, not `matrix[K, K]`.** An oversized parameter block leaves K(K+1)/2
  entries with no prior — an improper posterior. Measured at K=6, one such parameter reached
  **R̂ = 2.1** with a posterior mean of **1.4e+12** `[M]`. Because R̂ is per parameter, this trips
  your convergence check on parameters that never enter the model.
- **The prior scale depends on K.** This parameterization drops the transform's Jacobian, so
  the induced prior on `L` is whatever the unconstrained normal induces — you cannot bolt an
  LKJ prior onto it, and no fixed scale is "LKJ-equivalent" across K. Measured marginal sd of
  an off-diagonal correlation at K=10: `normal(0, 0.5)` gives **0.364**, against **0.243** for
  LKJ(4) and **0.302** for LKJ(1) `[M]`. That is wider than uniform over correlation matrices — the
  opposite of shrinkage.

Simulated, 4000 draws per cell `[M]`:

| K | LKJ(4) marginal sd(r) | matching `normal(0, s)` |
|---|---|---|
| 5 | 0.289 | s ≈ 0.33 |
| 10 | 0.243 | s ≈ 0.28 |
| 20 | 0.192 | s ≈ 0.22 |

Simulate the transform at your actual K rather than reusing a number from this table.

## Identification

A model can be correct and still refuse to mix, because the likelihood does not distinguish
some parameter configurations. The sampler then wanders a ridge and R̂ never settles.

- **Factor and loading matrices are rotation- and sign-invariant.** `Lambda * f` and
  `(Lambda * R) * (R' * f)` give the same likelihood for any orthogonal `R`. Constrain
  `Lambda` — lower-triangular with positive diagonal is the usual choice — or fix an anchor
  item per factor. This is the same identification problem you solve in SEM by fixing a
  loading to 1 or standardizing the factor; Stan will not choose for you.
- **Label switching in mixtures.** Order a parameter (`ordered[K] mu`) or the components are
  exchangeable.
- **Additive constants.** An intercept plus a group mean that both float will trade off
  forever. Sum-to-zero constrain one.

Symptom to recognize: high R̂ and low ESS on a *subset* of parameters, while the log density
itself mixes fine.

## Vectorization is idiom, not just speed

```stan
for (n in 1:N) y[n] ~ normal(mu[n], sigma);   // avoid
y ~ normal(mu, sigma);                        // prefer
```

The vectorized form is clearer *and* builds a much smaller autodiff graph. Prefer it
everywhere; Part 2 quantifies why.

**`~` versus `target +=`.** The sampling statement drops constant terms, which is what you
want while sampling. When you need the true log density — for `log_lik` in
`generated quantities`, say — use the `_lpdf` form. `target += normal_lupdf(...)` is the
explicit "drop constants" version and matches `~`.

```stan
model      { y ~ normal(mu, sigma); }                         // constants dropped
generated quantities {
  vector[N] log_lik;
  for (n in 1:N) log_lik[n] = normal_lpdf(y[n] | mu[n], sigma);  // full density
}
```

Getting this wrong does not break sampling, but it silently corrupts LOO.

## What brms and lavaan were doing for you

Writing Stan by hand means taking back work those packages did silently:

| They handled | You now write |
|---|---|
| Non-centered hierarchical terms | `z ~ std_normal()` plus the transform |
| Weakly-informative default priors | Every prior, explicitly |
| `log_lik` for LOO | A `generated quantities` block |
| Factor identification | The constraint on `Lambda` |
| QR reparameterization of predictors | `qr_thin_Q` / `qr_thin_R` if collinearity bites |
| Sensible parameter naming for `posterior` | Names you choose |

## Validating

**LOO-CV**, computed from draws with no extra fitting:

```r
library(loo)
ll_a  <- fit_a$draws("log_lik")    # iterations x chains x observations
r_eff <- relative_eff(exp(ll_a))   # chains inferred from the array
loo_a <- loo(ll_a, r_eff = r_eff)
print(loo_a)                       # read the Pareto-k table, not just the elpd
loo_compare(loo_a, loo_b)
```

```python
import arviz as az
idata = az.from_cmdstanpy(fit, log_likelihood="log_lik")
az.compare({"model_a": idata_a, "model_b": idata_b})
```

Any Pareto-k > 0.7 means importance sampling failed for that observation and the estimate is
untrustworthy — refit those folds (`loo::reloo`) or use K-fold.

**LOO assumes exchangeable observations, so it is the wrong tool for time series** — it lets
the model see the future. Use leave-future-out / rolling-origin CV instead (Bürkner, Gabry &
Vehtari 2020) `[L]`.

For model weights prefer **stacking** over Bayesian model averaging: stacking optimizes
held-out predictive accuracy directly, while BMA weights by marginal likelihood, which is
sharply sensitive to the prior in ways that do not track prediction.
`loo::loo_model_weights(method = "stacking")`.

## The diagnostic gate

```r
fit$summary()[, c("variable", "rhat", "ess_bulk", "ess_tail")]
fit$diagnostic_summary()     # divergences, treedepth saturation, E-BFMI
```

- **R̂ > 1.01**: chains have not mixed — do not use the posterior. (1.05 is the older,
  now-inadequate threshold; Vehtari et al. 2021 tightened it and the Stan Reference Manual
  follows `[L]`.)
- **Bulk-ESS < 400** (≈100 per chain at 4 chains): not enough for reliable posterior means.
- **Tail-ESS < 400**: Bulk-ESS can look fine while the tails are badly estimated — which is
  exactly where your interval endpoints live. Check both.
- **Divergences > 0**: the sampler hit geometry it could not resolve; the posterior may be
  biased. Reparameterize, tighten priors, raise `adapt_delta`. Do not ignore a handful.
- **Thinning does not raise ESS.** It discards information. Thin only to save disk.

Everything in Part 2 is subject to this gate. A faster model that fails it is not faster, it
is broken.

---

# Part 2 — Making Them Go Brrr

Work down this list in order. Each stage is cheaper and safer than the one below it, and the
early stages often make the later ones unnecessary. Never start at the bottom: swapping in an
approximate posterior to fix a problem that was really an unvectorized loop trades correctness
for nothing.

## Stage 0 — Profile first

Most people optimize the wrong thing. Two measurements decide which lever to pull.

**Where in the model does time go?** Stan has built-in profiling `[C]`. Wrap suspect
regions:

```stan
model {
  profile("priors") {
    z ~ std_normal();
    sigma ~ normal(0, 1);
  }
  profile("likelihood") {
    vector[N] eta = X * beta;
    y ~ bernoulli_logit(eta);
  }
}
```

```r
fit <- mod$sample(data = stan_data, chains = 4, parallel_chains = 4)
fit$profiles()      # per-block: forward pass, reverse pass, gradient evaluations
```

This tells you which block to attack, and it is far better than guessing.

**Is it geometry or gradient cost?**

```r
fit$time()                                            # warmup vs sampling, per chain
fit$diagnostic_summary()                              # treedepth saturation
leapfrogs <- sum(fit$sampler_diagnostics()[,,"n_leapfrog__"])
sampling_seconds / leapfrogs                          # cost per gradient
```

- **Many leapfrogs per iteration** (treedepth saturating at 10 means 1023 gradient
  evaluations *per draw*) → geometry problem. Reparameterize. This is the highest-payoff
  finding on the list.
- **Few leapfrogs but still slow** → each gradient is expensive. Vectorize, use GLM
  primitives, hoist constants.

These call for opposite fixes, so measuring first is not optional.

**Is it warmup or sampling?** `fit$time()` splits them. Warmup is commonly 50–70% of total,
which matters enormously for a scheduled job — see Stage 4.

## Stage 1 — Free wins, no model change

**Compiler flags.** All three confirmed present in CmdStan 2.38's makefile `[D]`:

```r
mod <- cmdstan_model("model.stan", cpp_options = list(
  STAN_CPP_OPTIMS = TRUE,        # extra optimization flags
  STAN_NO_RANGE_CHECKS = TRUE    # removes bounds checks: only once the model is debugged
))
```

Reported typically 10–30%; unverified here, so measure it on your model. `STAN_NO_RANGE_CHECKS` removes the guardrails that produce readable index
errors, so enable it only after the model is correct, and turn it off when debugging.

**Run chains in parallel.** Trivial and frequently overlooked:

```r
fit <- mod$sample(data = stan_data, chains = 4, parallel_chains = 4)
```

Four chains run serially on a multi-core box wastes roughly a 4x factor for no reason.

## Stage 2 — Cheap wins, no change to the math

**Stop sampling more than you need.** The default 4×(1000+1000) yields 4000 draws when the
diagnostic threshold is Bulk-ESS and Tail-ESS ≥ 400. If a run reports ESS in the thousands,
you are paying for precision you are not using. Halving `iter_sampling` halves that phase.
Check ESS after cutting, not before.

**Vectorize.** The loop and the vectorized form compute the same number, but the loop builds
N separate autodiff nodes:

```stan
for (n in 1:N) y[n] ~ normal(mu[n], sigma);   // N nodes
y ~ normal(mu, sigma);                        // one
```

**Hoist anything constant into `transformed data`.** Standardization, index arrays,
`log()` of fixed inputs. Computed once instead of once per leapfrog.

**Use the GLM primitives.** These have hand-written analytic gradients instead of autodiff
through the composed expression, and they are often the single largest per-gradient win.
Both compile under 2.38 `[C]`:

```stan
y  ~ ordered_logistic_glm(x, beta, cut);   // ordinal outcomes - IRT, Likert
yb ~ bernoulli_logit_glm(x, alpha, beta);  // binary outcomes
```

Also available, all four compiled `[C]`: `normal_id_glm`, `poisson_log_glm`,
`neg_binomial_2_log_glm`, and `categorical_logit_glm` (note its `alpha` is `vector[C]` and
`beta` is `matrix[K, C]`, not the row_vector shape the others might lead you to expect). If your model builds a linear predictor and feeds it to a link, there
is probably a `_glm` form for it.

**Collapse to sufficient statistics.** Repeated identical rows can be aggregated:
`bernoulli` over many trials becomes one `binomial`; in item-response data with many
respondents and few items, identical response patterns collapse to a pattern plus a count.
This can cut N by an order of magnitude with no change to the posterior.

## Stage 3 — Structural, still exact

**Within-chain threading with `reduce_sum`.** Available in 2.38 `[C]`. Partition the data
sum across threads:

```stan
functions {
  real partial(array[] real slice_y, int start, int end, vector mu, real sigma) {
    return normal_lpdf(to_vector(slice_y) | mu[start:end], sigma);
  }
}
model {
  target += reduce_sum(partial, y, grainsize, mu, sigma);
}
```

```r
mod <- cmdstan_model("model.stan", cpp_options = list(stan_threads = TRUE))
fit <- mod$sample(data = stan_data, chains = 4, parallel_chains = 4, threads_per_chain = 4)
```

Near-linear until memory bandwidth binds — a general property of the approach, not measured
here. Budget cores as
`parallel_chains × threads_per_chain ≤ physical cores`. Start `grainsize` at 1 and let the
scheduler decide.

**Fix the geometry rather than raising `adapt_delta`.** If Stage 0 showed treedepth
saturation, the answer is non-centered parameterization, log-scale priors on positive
parameters, or a QR reparameterization for collinear predictors — not `adapt_delta = 0.999`.
Raising `adapt_delta` shrinks the step size, which *increases* the number of leapfrogs per
iteration. It buys fewer divergences at the price of a slower run, and it treats the symptom.

## Stage 4 — The lever for scheduled runs

A daily job re-learns the same metric every single day. Warmup is usually the largest block of
time, and yesterday's step size and inverse metric are very nearly right for today.

```r
prev <- readRDS("cache/fit_yesterday.rds")

# $inv_metric(matrix = FALSE) returns a list, one diagonal vector per chain, and
# metadata()$step_size_adaptation is one value per chain. $sample() documents a
# single vector and a single initial step size, so collapse across chains.
fit <- mod$sample(
  data            = stan_data_today,
  chains          = 4,
  parallel_chains = 4,
  init            = prev,                                  # fit object accepted directly
  step_size       = mean(prev$metadata()$step_size_adaptation),
  inv_metric      = prev$inv_metric(matrix = FALSE)[[1]],
  iter_warmup     = 200                                    # short, but still adapting
)
```

```python
chains = 4
par_names = model.src_info()["parameters"].keys()
inits = [{n: prev.stan_variable(n)[-(i + 1)] for n in par_names} for i in range(chains)]

fit = model.sample(
    data=stan_data_today, chains=chains, inits=inits,
    step_size=prev.step_size.tolist(),   # ndarray -> list[float]
    inv_metric=prev.inv_metric,          # `.metric` is deprecated
    iter_warmup=200,
)
```

**Keep adaptation on with a short warmup rather than setting `adapt_engaged = FALSE`.** If the
new day's data shifted the posterior, a frozen metric is wrong and you get bad sampling with
no warning. A short warmup re-checks cheaply.

**Gate it on diagnostics.** A warm-started run that comes back with R̂ > 1.01 should trigger a
cold refit, not a silent publish. In a scheduled pipeline this check is the difference between
a fast job and a fast wrong job.

Measure the gain on your own model rather than trusting a general figure; it depends entirely
on how much of your runtime is warmup.

## Stage 5 — Scaling when K is large

**Factor models** replace a K×K covariance (O(K²) parameters) with R << K latent factors
(O(R×K)):

```text
y_t = Lambda * f_t + eps_t,   f_t ~ N(0, I_R)
Cov(y_t) = Lambda * Lambda' + diag(psi)
```

K=50, R=5 is 250 parameters instead of 2500. Constrain `Lambda` for identification (Part 1).
This is factor analysis in the SEM sense; multidimensional IRT is its categorical-outcome
counterpart, with discriminations playing the role of loadings.

**Regularized horseshoe** for sparse coefficient matrices — use the regularized form (Piironen
& Vehtari 2017), not the original, whose unbounded Cauchy local scales create a funnel NUTS
handles badly:

```stan
data {
  int<lower=1> P;
  real<lower=0> tau_0;         // from expected sparsity, not arbitrary
}
parameters {
  real<lower=0> tau;           // global scale
  vector<lower=0>[P] lambda;   // local scales
  real<lower=0> c2;            // slab width: bounds how large a "large" coefficient gets
  vector[P] z;
}
transformed parameters {
  vector[P] lambda_tilde = sqrt(c2 * square(lambda)
                                ./ (c2 + square(tau) * square(lambda)));
  vector[P] beta = z .* (tau * lambda_tilde);
}
model {
  z      ~ std_normal();
  lambda ~ cauchy(0, 1);
  tau    ~ cauchy(0, tau_0);
  c2     ~ inv_gamma(2, 8);    // ~ Student-t(4, 0, 2) slab
  // ... likelihood in terms of beta
}
```

Set `tau_0` from the number of coefficients you expect to be nonzero. The Minnesota prior is a
fixed, non-adaptive version of the same idea.

## Stage 6 — Trading exactness, last resort

Only after Stages 0–4. These change the answer, so validate against a full MCMC fit on at
least one representative dataset before shipping, and re-validate periodically.

**Pathfinder.** L-BFGS from multiple starting points, then importance-resampled draws. Cheap.
Best used as an initializer; usable standalone when you need speed over calibration.

```r
pf  <- mod$pathfinder(data = stan_data)
fit <- mod$sample(data = stan_data, chains = 4, init = pf)   # fit object accepted directly
```

```python
approx = model.pathfinder(data=stan_data)
fit = model.sample(data=stan_data, chains=4, inits=approx.create_inits(chains=4))
```

cmdstanr's `init` takes a fit object directly — `CmdStanMCMC`, `CmdStanMLE`, `CmdStanVB`,
`CmdStanPathfinder`, `CmdStanLaplace`, or a `posterior::draws` — while cmdstanpy's `inits`
accepts only a number, a dict, a JSON/Rdump path, or a list of those, hence `create_inits()`
`[D]`.

**Laplace approximation.** Gaussian at the posterior mode, using the Hessian there.

```r
mode <- mod$optimize(data = stan_data, jacobian = TRUE)   # jacobian=TRUE for the true mode
lap  <- mod$laplace(data = stan_data, mode = mode)
```

Set `jacobian = TRUE`: you want the mode on the unconstrained scale, which is what the
approximation is built around.

**ADVI last.** Stan prints `EXPERIMENTAL ALGORITHM:` when you run `$variational()`, and it
means it — ADVI fails unpredictably on hierarchical models, often without obvious symptoms.
Prefer Pathfinder or Laplace.

**Prophet, for reference**, defaults to MAP only (`optimize`, L-BFGS falling back to Newton)
`[D]` — its own docstring says *"If 0, will do MAP estimation… only the uncertainty in the
trend"*.
Its intervals come from simulating future changepoints and observation noise; parameter
uncertainty is not propagated unless you set `mcmc_samples > 0`. Its internal
`np.random.laplace` draws changepoint magnitudes from the Laplace *distribution* and is
unrelated to the Laplace approximation.

## Stage 7 — When the structure lets you skip MCMC

**Kalman filter.** Any linear Gaussian ARIMA model is exactly a state-space model, and the
Kalman filter gives the **exact posterior** `p(x_t | y_1..y_t)` in O(K³) per time step — no
sampling, just matrix algebra. One predict step plus one update step per new observation, so a
daily run costs one update rather than a refit.

```text
State:       x_t = B * x_{t-1} + w_t
Observation: y_t = H * x_t     + v_t
```

For VARIMA, stack lagged innovations into the state for MA terms; regressors are known inputs;
Fourier seasonality folds into the state. Breaks on non-Gaussian errors or nonlinear dynamics.

**Particle filters / SMC** generalize this to nonlinear and non-Gaussian models at
O(N_particles) per step. Watch for particle degeneracy: in high dimensions the effective
particle count collapses and the filter reports overconfident results without complaining.

**Conjugate updating.** Gaussian-Gaussian, Beta-Binomial, Gamma-Poisson give closed-form exact
posterior updates at O(1). Limited to specific families, unbeatable when they apply.

**Amortized inference / SBI.** One expensive training run of a neural network mapping data →
posterior parameters, then instant inference on new data from the same generative process.
Worth considering only when you will run inference very many times.

---

## Quick decision guide

| Situation | Do this |
|---|---|
| Model is slow and you have not measured | `fit$profiles()`, `fit$time()`, treedepth — Stage 0 |
| Treedepth saturating | Reparameterize; do not raise `adapt_delta` |
| Slow gradients, few leapfrogs | Vectorize, GLM primitives, hoist to `transformed data` |
| Multi-core box, one chain at a time | `parallel_chains`, then `reduce_sum` |
| ESS in the thousands | Cut `iter_sampling` |
| Scheduled or daily run | Warm-start: `init`, `step_size`, `inv_metric`, short warmup |
| Repeated identical observations | Collapse to sufficient statistics |
| K > 20 series | Factor model or regularized horseshoe |
| Still too slow, exactness negotiable | Pathfinder, then Laplace; ADVI last |
| Model is linear Gaussian | Kalman filter — exact, no MCMC |
| Divergences after any change | Stop; the diagnostic gate outranks the speedup |
| Comparing two models | LOO-CV, read Pareto-k |
| Comparing two time series models | Leave-future-out CV, not LOO |

---

## Provenance and re-verification

**Verified 2026-09-03** against:

| Component | Version |
|---|---|
| CmdStan / stanc3 | 2.38.0 |
| cmdstanpy | 1.3.0 |
| prophet | 1.3.0 |
| cmdstanr | not installed; `[D]` claims come from the published reference |

**How each marker was established.**

- `[C]` — the snippet was written to a file and run through `stanc`. Fragments that are not
  whole programs (illustrative pairs, `functions` blocks) were scaffolded with a minimal
  `data`/`parameters`/`model` before checking.
- `[M]` — a full program was compiled and sampled under CmdStan 2.38.0, and the number was
  read from `stansummary` or from the output CSV. Correlation-prior figures additionally
  cross-checked against an independent simulation of the same transform, which agreed to
  three decimals.
- `[D]` — read from the installed library source (cmdstanpy, prophet) or the published
  reference (cmdstanr `$sample`, `$inv_metric`, `$metadata`; Stan Reference Manual). **Not
  executed.** This is the class most likely to drift as libraries change.
- `[L]` — from the cited paper or manual section.

**Known gaps.** No R driver call was executed, because cmdstanr is not installed in the
environment this was checked in. The performance percentages in Part 2 Stage 1 are reported
figures, not measurements. Nothing in Part 2 has been benchmarked end-to-end on a real model —
the *ordering* of the stages is a reasoned argument from where time goes, not an empirical
ranking.

**Re-checking the Stan.** Every `[C]` and `[M]` claim rests on code in this file, so it can be
re-verified directly. This extracts each complete program and compiles it:

```bash
python3 - <<'EOF'
import re, subprocess, tempfile, os
STANC = os.path.expanduser("~/.cmdstan/cmdstan-2.38.0/bin/stanc")
src = open("CLAUDE_bayesian-production-tricks.md").read()
for i, b in enumerate(re.findall(r"```stan\n(.*?)```", src, re.S), 1):
    if not ("parameters" in b and "model" in b and "data" in b):
        print(f"block {i}: fragment (scaffold to check)"); continue
    with tempfile.NamedTemporaryFile("w", suffix=".stan", delete=False) as f:
        f.write(b); path = f.name
    r = subprocess.run([STANC, "--o=/dev/null", path], capture_output=True, text=True)
    err = (r.stdout + r.stderr).strip()
    print(f"block {i}: {'OK' if not err else 'FAIL -> ' + err[:200]}")
    os.unlink(path)
EOF
```

Run this after any edit, and after any CmdStan upgrade. A `[C]` marker that no longer holds is
a bug in this file, not in your model.

**When updating this guide:** move a claim's marker down, never up, unless you actually redid
the work. Promoting `[D]` to `[M]` without measuring is how a guide starts lying.

## References

- Stan User's Guide — Efficiency Tuning; Parallelization (`reduce_sum`)
- Stan Reference Manual — Constraint Transforms; Posterior Analysis (R̂, Bulk/Tail-ESS)
- Stan Functions Reference — GLM primitives
- Betancourt, *A Conceptual Introduction to Hamiltonian Monte Carlo* (2017)
- Betancourt & Girolami (2015) — HMC for hierarchical models; when centered beats non-centered
- Gelman et al., *Bayesian Data Analysis* (3rd ed.)
- Durbin & Koopman, *Time Series Analysis by State Space Methods*
- Piironen & Vehtari (2017) — regularized horseshoe
- Vehtari, Gelman, Simpson, Carpenter & Bürkner (2021) — improved R̂, Bulk/Tail-ESS,
  *Bayesian Analysis* 16:667–718
- Vehtari, Gelman & Gabry (2017) — practical Bayesian model evaluation using LOO and WAIC
- Bürkner, Gabry & Vehtari (2020) — approximate leave-future-out CV for time series
- Yao et al. (2018) — stacking vs BMA
- Zhang et al. (2022) — Pathfinder algorithm
