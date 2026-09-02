# Bayesian Methods in Production

Reference for Claude. When working on Bayesian models, probabilistic inference, or time
series problems, consult this guide and apply these techniques appropriately. Prefer
principled solutions from this list over ad-hoc fixes.

Stan code is language-agnostic; driver examples are given in R (cmdstanr) first, with Python
(cmdstanpy) alongside where the call differs meaningfully. Every Stan program here compiles
under CmdStan 2.38.0, and the diagnostic figures quoted are measured, not estimated.

---

## Making Inference Fast Enough to Run Repeatedly

### Kalman Filter / State-Space Models

Any linear Gaussian ARIMA model is mathematically identical to a state-space model. In
state-space form, the Kalman filter gives the **exact posterior** `p(x_t | y_1,...,y_t)` in
**O(K³)** per time step — no MCMC, just matrix multiplications. True online updating: one
predict step + one update step per new observation.

```text
State transition:  x_t = B * x_{t-1} + w_t
Observation:       y_t = H * x_t     + v_t
```

For VARIMA: stack lagged innovations into the state vector for MA terms. Regressors are
known inputs to the transition. Fourier seasonality terms fold into the state.

**Breaks when**: non-Gaussian errors or nonlinear dynamics → use particle filters instead.

**Use when**: the model is linear Gaussian and you need sub-second updates on new data.

### Pathfinder

Runs L-BFGS from multiple starting points, then draws importance-resampled samples from the
best local approximation. Much cheaper than full NUTS warmup, and the default choice when you
need a fast approximate posterior or a good place to start MCMC from. Available since
CmdStan 2.33.

```r
mod <- cmdstanr::cmdstan_model("model.stan")
pf  <- mod$pathfinder(data = stan_data)

# cmdstanr accepts a fit object directly as `init`
fit <- mod$sample(data = stan_data, chains = 4, parallel_chains = 4, init = pf)
```

```python
approx = model.pathfinder(data=stan_data)
fit = model.sample(data=stan_data, chains=4, inits=approx.create_inits(chains=4))
```

Note the asymmetry: cmdstanr's `init` accepts a `CmdStanPathfinder` (also `CmdStanMCMC`,
`CmdStanMLE`, `CmdStanVB`, `CmdStanLaplace`, or a `posterior::draws` object) directly.
cmdstanpy's `inits` does not — it takes a number, a dict, a path to a JSON or Rdump file, or
a list of those, so you must call `.create_inits()` to convert.

### Laplace Approximation

Fit a Gaussian at the posterior mode, using the Hessian at the mode as the covariance. Faster
than VI. Works well when the posterior is roughly symmetric and unimodal.

```r
mode <- mod$optimize(data = stan_data, jacobian = TRUE)   # jacobian=TRUE for the true mode
lap  <- mod$laplace(data = stan_data, mode = mode)
```

```python
lap = model.laplace_sample(data=stan_data)
```

Set `jacobian = TRUE` when optimizing for a Laplace approximation: you want the mode of the
posterior on the unconstrained scale, which is what the approximation is built around.

**Use when**: posterior is well-behaved and you need speed over accuracy.

**Prophet does not do this.** With the default `mcmc_samples=0`, Prophet runs MAP only
(`optimize`, L-BFGS falling back to Newton). Its intervals come from simulating future
changepoints and from observation noise — parameter uncertainty is not propagated at all. Set
`mcmc_samples > 0` if you need real posterior uncertainty. (Prophet's internal
`np.random.laplace` calls draw changepoint magnitudes from the Laplace *distribution*; they
are unrelated to the Laplace approximation.)

### Variational Inference (VI)

Approximate the posterior with a simpler parametric family, optimize the ELBO instead of
sampling. Often 10–100x faster than MCMC. Biased — underestimates uncertainty, misses
correlations in mean-field form.

Stan's ADVI (`$variational()` / `model.variational()`) prints `EXPERIMENTAL ALGORITHM:` when
you run it, and that warning is meant seriously — it fails unpredictably on hierarchical
models, often without obvious symptoms. Reach for Pathfinder or Laplace first. If you do use
ADVI, compare it against MCMC on at least one representative dataset before shipping.

Full-rank VI captures correlations at O(K²) parameters, correspondingly slower and less
stable than mean-field.

### Amortized Inference / Neural Posterior Estimation

Train a neural network to map data → posterior parameters. One expensive upfront training
run, then inference is instant for new data of the same type. Used in simulation-based
inference (SBI) when the likelihood is intractable.

**Use when**: you will run inference repeatedly on data from the same generative process.

---

## Making MCMC Itself Faster and More Reliable

### Non-Centered Parameterization

The highest-leverage reparameterization for hierarchical models under HMC/NUTS. Instead of
sampling `theta ~ normal(mu, sigma)` directly, sample `z ~ std_normal()` and recover
`theta = mu + sigma * z`. This decouples the prior geometry from the likelihood and
dramatically reduces divergences when `sigma` is small or poorly identified.

```stan
// Centered:
theta ~ normal(mu, sigma);

// Non-centered (in transformed parameters):
z ~ std_normal();
theta = mu + sigma * z;
```

**It is not universally better.** Non-centered wins when the data are *weak* relative to the
prior — few observations per group, `sigma` near zero. Centered wins when the data are
*strong*: many observations per group pin each `theta` down, and the non-centered form then
induces its own funnel. Betancourt & Girolami (2015) work through both regimes. With uneven
group sizes, try both and compare divergences and ESS, or parameterize per group.

### Correlation Matrices

Use `cholesky_factor_corr` with an LKJ prior. It is correct, it carries its Jacobian, and its
geometry is good:

```stan
data       { int<lower=1> K; }
parameters { cholesky_factor_corr[K] L; }
model      { L ~ lkj_corr_cholesky(4); }
```

You will sometimes see warmup messages like:

```text
Informational Message: The current Metropolis proposal is about to be rejected...
Exception: lkj_corr_cholesky_lpdf: Random variable[7] is 0, but must be positive!
```

**These are usually harmless.** They come from the density, not the geometry:
`lkj_corr_cholesky_lpdf` evaluates `sum(log(diag(L)))`, and when a diagonal element underflows
to exactly 0 in floating point that term is `-inf` and the function throws. Measured at K=10,
4 chains, 1000+1000 iterations: 26 such warmup messages, and the fit still finished with
**0 divergences, R̂ = 1.00, Bulk-ESS ≈ 1700–2300**. Judge the fit by sampling-phase
divergences and R̂/ESS, not by warmup message count.

Do not hand-roll the transform hoping for better geometry. Stan's `cholesky_factor_corr` *is*
the tanh + signed stick-breaking map — `z = tanh(y)`, then
`x[i,j] = z[i,j] * sqrt(1 - sum_{j'<j} x[i,j']^2)` — so a hand-rolled version samples in
exactly the same space and buys nothing.

**The one real reason to hand-roll** is to put a prior directly on the unconstrained scale,
which sidesteps `lkj_corr_cholesky_lpdf` entirely. Do that only if the warmup exceptions are
frequent enough that adaptation actually fails:

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
  z_raw ~ normal(0, 0.28);   // K-dependent; see the table below
}
```

Three details in that snippet are load-bearing:

- **`rep_matrix(0, K, K)`.** Stan neither initializes nor validates an unconstrained `matrix`
  in transformed parameters. Declare it bare and fill only the lower triangle and the model
  still *runs clean* while writing `nan` into every upper-triangle cell — 4500 of them in a
  600-draw K=6 fit. A downstream `multi_normal_cholesky(mu, L)` then rejects every proposal.
  Silent wrong answers, not a crash.
- **`vector[n_corr]`, not `matrix[K, K]`.** An oversized parameter block leaves K(K+1)/2
  entries with no prior at all, which is an improper posterior. Measured at K=6:
  `z_corr_raw[1,1]` reached **R̂ = 2.1** with a posterior mean of **1.4e+12**, a pure random
  walk. Because R̂ is reported per parameter, this trips the convergence check below on
  parameters that do not even enter the model.
- **The prior scale is K-dependent.** This parameterization drops the transform's Jacobian, so
  the induced prior on `L` is whatever the unconstrained normal induces — you cannot bolt an
  LKJ prior onto it, and no fixed scale is "LKJ-equivalent" across K. Measured marginal sd of
  an off-diagonal correlation at K=10: `normal(0, 0.5)` gives **0.364**, against **0.243** for
  LKJ(4) and **0.302** for LKJ(1). That is wider than uniform over correlation matrices — the
  opposite of shrinkage.

| K | LKJ(4) marginal sd(r) | matching `normal(0, s)` |
|---|---|---|
| 5 | 0.289 | s ≈ 0.33 |
| 10 | 0.243 | s ≈ 0.28 |
| 20 | 0.192 | s ≈ 0.22 |

Run a prior-predictive simulation of the transform at your actual K rather than reusing a
number from this table.

### Priors on Positive Parameters

**Stan has no `half_normal` distribution.** `sigma ~ half_normal(0.1)` is a compile error:

```text
Ill-typed arguments to "~"-statement. No function "half_normal_lpdf" was found
when looking for distribution "half_normal".
```

You get a half-normal by declaring `<lower=0>` and using `normal(0, s)`. Stan handles the
truncation constant, which is constant and so does not affect sampling:

```stan
real<lower=0> sigma;
sigma ~ normal(0, 0.1);   // half-normal(0, 0.1)
```

A `<lower=0>` declaration already makes Stan sample `log(sigma)` internally and apply the
Jacobian, so declaring `log_sigma` yourself is **not** a sampler-geometry optimization. What it
changes is the prior:

```stan
data              { int<lower=1> K; }
parameters        { vector[K] log_sigma; }
transformed parameters { vector<lower=0>[K] sigma = exp(log_sigma); }
model             { log_sigma ~ normal(0, 0.5); }
// implied lognormal: median 1.00, mode 0.78, 90% interval [0.44, 2.28]
```

A half-normal has its highest density *at* zero; the lognormal above has zero density there.
Use the log-scale form when you want to exclude `sigma = 0` — it can rescue a variance
component that would otherwise collapse. Scale it to your data; `normal(0, 0.5)` on the log
scale is fairly informative and centered on `sigma ≈ 1`.

### Warm-Starting from a Previous Posterior

Re-running warmup is mostly about re-learning the **step size** and the **inverse metric**;
initial values are the smaller part. Reuse all three.

```r
prev <- mod$sample(data = stan_data, chains = 4, parallel_chains = 4)

warm <- mod$sample(
  data         = stan_data_new,
  chains       = 4,
  parallel_chains = 4,
  init         = prev,                    # fit object accepted directly
  step_size    = prev$metadata()$step_size_adaptation,
  inv_metric   = prev$inv_metric(matrix = FALSE),
  iter_warmup  = 200                      # short, but still adapting
)
```

```python
chains = 4
prev = model.sample(data=stan_data, chains=chains)

par_names = model.src_info()["parameters"].keys()
inits = [
    {name: prev.stan_variable(name)[-(i + 1)] for name in par_names}
    for i in range(chains)
]

warm = model.sample(
    data=stan_data_new,
    chains=chains,
    inits=inits,
    step_size=prev.step_size.tolist(),   # ndarray -> list[float]
    inv_metric=prev.inv_metric,          # `.metric` is deprecated
    iter_warmup=200,
)
```

Prefer a short `iter_warmup` over `adapt_engaged=FALSE`. If the new data have shifted the
posterior, a frozen metric from the old fit is wrong and you get bad sampling with no warning.
Measure the speedup on your own model before relying on it.

### Sampler Settings for Difficult Models

- `adapt_delta = 0.95` (default 0.8) — smaller step size, fewer divergences, slower
- `max_treedepth = 12` (default 10) — allows deeper trees for complex posteriors
- `iter_warmup = 1000, iter_sampling = 1000`

Raising `adapt_delta` treats a symptom. If divergences persist above 0.95, the geometry is the
problem — reparameterize rather than climbing toward 0.999.

---

## Handling New Data Without a Full Refit

| Method | Exact? | Requires linear Gaussian? | Cost per update |
|--------|--------|--------------------------|-----------------|
| Kalman filter | Yes | Yes | O(K³) |
| Conjugate updating | Yes | Depends | O(1) |
| Particle filter (SMC) | Approx | No | O(N_particles) |
| Streaming VI | Approx | No | O(iterations) |
| Warm-start MCMC | Full refit | No | Faster; measure it |

### Conjugate Updating

When likelihood and prior are conjugate (Gaussian-Gaussian, Beta-Binomial, Gamma-Poisson), the
posterior has the same form as the prior — closed-form exact updating with no MCMC. Very fast,
limited to specific model families.

### Particle Filters / Sequential Monte Carlo

The nonlinear/non-Gaussian generalization of the Kalman filter. Maintain N weighted particles,
reweight and resample as new data arrives. Watch for particle degeneracy: in high dimensions
the effective particle count collapses and the filter silently reports overconfident results.

---

## Scaling to Large Numbers of Series (Large K)

### Factor Models

Replace a K×K covariance matrix (O(K²) parameters) with R << K latent factors (O(R×K)):

```text
y_t = Lambda * f_t + eps_t,   f_t ~ N(0, I_R)
Cov(y_t) = Lambda * Lambda' + diag(psi)
```

For K=50, R=5: 250 vs 2500 parameters. Use when K is large and you suspect low-dimensional
shared structure. Factor models are rotation- and sign-invariant, so constrain `Lambda` — e.g.
lower-triangular with positive diagonal — or the chains will not mix.

### Sparse VAR with a Regularized Horseshoe

Regularize most cross-lag VAR coefficients toward zero. Use the **regularized** horseshoe
(Piironen & Vehtari 2017), not the original: the original's Cauchy local scales are unbounded
above, producing a funnel that NUTS handles badly.

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

Set `tau_0` from the number of coefficients you expect to be nonzero, not by guessing.
The Minnesota prior is a fixed, non-adaptive version of the same idea; prefer the regularized
horseshoe when you do not know which cross-lags are relevant.

### Hierarchical Shrinkage

Pool information across related series through shared hyperparameters, non-centered:

```stan
data { int<lower=1> K; }
parameters {
  real mu_ar;
  real<lower=0> sigma_ar;
  vector[K] z_ar;
}
transformed parameters {
  vector[K] B_own = mu_ar + sigma_ar * z_ar;
}
model {
  z_ar     ~ std_normal();
  mu_ar    ~ normal(0.3, 0.2);
  sigma_ar ~ normal(0, 0.1);   // half-normal via the <lower=0> declaration
}
```

---

## Model Comparison and Validation

### LOO-CV

Compute from posterior draws with no extra fitting. Prefer LOO-CV over WAIC — better
theoretical properties, and it reports Pareto-k diagnostics that tell you when it is
unreliable.

```r
library(loo)
ll_a   <- fit_a$draws("log_lik")
r_eff  <- relative_eff(exp(ll_a), chain_id = rep(1:4, each = 1000))
loo_a  <- loo(ll_a, r_eff = r_eff)
print(loo_a)                       # inspect the Pareto-k table
loo_compare(loo_a, loo_b)
```

```python
import arviz as az
idata = az.from_cmdstanpy(fit, log_likelihood="log_lik")
loo = az.loo(idata)
az.compare({"model_a": idata_a, "model_b": idata_b})
```

**Read the Pareto-k values, not just the elpd.** Any k > 0.7 means importance sampling has
failed for that observation and the estimate is untrustworthy; refit those folds exactly
(`loo::reloo`) or switch to K-fold CV.

**LOO-CV assumes exchangeable observations, so it is the wrong tool for time series** — it lets
the model see the future. Use leave-future-out / rolling-origin CV instead (Bürkner, Gabry &
Vehtari 2020). This matters here: most models in this guide are time series.

### Stacking vs Bayesian Model Averaging

Prefer **stacking**. It optimizes held-out predictive accuracy directly, whereas BMA weights by
marginal likelihood, which is sensitive to the prior in ways that do not track predictive
quality. `loo::loo_model_weights(method = "stacking")` in R; ArviZ implements both.

### Convergence Diagnostics

```r
fit$summary()[, c("variable", "rhat", "ess_bulk", "ess_tail")]
fit$diagnostic_summary()     # divergences, treedepth saturation, E-BFMI
```

- **R̂ > 1.01**: chains have not mixed — do not use the posterior. Fix: more warmup, better
  parameterization, tighter priors. (1.05 is the older, now-inadequate threshold; Vehtari et
  al. 2021 tightened it and the Stan Reference Manual follows.)
- **Bulk-ESS < 400** (≈100 per chain at 4 chains): not enough effective samples for reliable
  posterior means.
- **Tail-ESS < 400**: Bulk-ESS can look fine while the tails are badly estimated — which is
  exactly where credible-interval endpoints live. Check both.
- **Divergences > 0**: the sampler hit a region it could not resolve, and the posterior may be
  biased. Fix: non-centered parameterization, tighter priors, higher `adapt_delta`. Do not
  ignore even a handful.
- **Thinning does not raise ESS.** It discards information and lowers it. Thin only to save
  disk.

---

## Quick Decision Guide

| Situation | Recommended approach |
|-----------|---------------------|
| Linear Gaussian model, need online updates | Kalman filter |
| Non-linear model, need online updates | Particle filter |
| Need a fast approximate posterior | Pathfinder, then Laplace; ADVI last |
| MCMC has many divergences | Non-centered parameterization; check which way the funnel points |
| Correlation matrix warmup exceptions | Usually ignorable — check divergences and R̂ first |
| Correlation matrix genuinely failing to adapt | Unconstrained parameterization, prior scale calibrated to K |
| Running the same model repeatedly | Warm-start: reuse `init`, `step_size` and `inv_metric` |
| K > 20 series | Factor model or regularized-horseshoe VAR |
| Comparing two models | LOO-CV — read the Pareto-k table |
| Comparing two **time series** models | Leave-future-out CV, not LOO |
| Prior run finished, new month of data | Warm-start MCMC, or Kalman update if linear Gaussian |

---

## References

- Gelman et al., *Bayesian Data Analysis* (3rd ed.)
- Stan Reference Manual — Constraint Transforms, "Cholesky factors of correlation matrices"
- Stan Reference Manual — Posterior Analysis (R̂, Bulk-ESS, Tail-ESS)
- Betancourt, *A Conceptual Introduction to Hamiltonian Monte Carlo* (2017)
- Betancourt & Girolami (2015) — HMC for hierarchical models; when centered beats non-centered
- Durbin & Koopman, *Time Series Analysis by State Space Methods*
- Carvalho, Polson & Scott (2010) — horseshoe prior
- Piironen & Vehtari (2017) — regularized horseshoe
- Vehtari, Gelman, Simpson, Carpenter & Bürkner (2021) — improved R̂, Bulk/Tail-ESS,
  *Bayesian Analysis* 16:667–718
- Vehtari, Gelman & Gabry (2017) — practical Bayesian model evaluation using LOO and WAIC
- Bürkner, Gabry & Vehtari (2020) — approximate leave-future-out CV for time series
- Yao et al. (2018) — stacking vs BMA
- Zhang et al. (2022) — Pathfinder algorithm
