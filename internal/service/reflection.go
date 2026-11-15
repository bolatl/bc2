package service

import (
	"context"
	"lovelab/internal/dto"
	"lovelab/internal/llm"
	"lovelab/internal/model"
)

// Both outputs use the same read-only owned conversation; neither depends on
// the other. Generate them together so reflection has the whole request budget.
// Workers never mutate a session, and all workers finish before any result is
// attached. A failure cancels its sibling and leaves the existing result intact.
func (a *App) generateResultWithReflection(ctx context.Context, c model.Couple, f *model.FightSession) error {
	analyzer, ok := a.LLM.(llm.ReflectionAnalyzer)
	if !ok {
		// Older/custom clients may implement only the original generation boundary.
		return a.generateResult(ctx, c, f)
	}
	input, err := a.fightInput(c, *f)
	if err != nil {
		return err
	}
	workCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	type outcome struct {
		result     *model.FightResult
		reflection llm.Reflection
		err        error
	}
	completed := make(chan outcome, 2)
	go func() {
		result, err := a.resultFromInput(workCtx, input)
		completed <- outcome{result: result, err: err}
	}()
	go func() {
		reflection, err := analyzer.AnalyzeReflection(workCtx, input)
		completed <- outcome{reflection: reflection, err: err}
	}()
	var result *model.FightResult
	var reflection llm.Reflection
	var firstErr error
	for range 2 {
		out := <-completed
		if out.err != nil && firstErr == nil {
			firstErr = out.err
			cancel()
		}
		if out.result != nil {
			result = out.result
		} else if out.err == nil {
			reflection = out.reflection
		}
	}
	if firstErr != nil {
		return firstErr
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	result.Reflection = &model.ConversationReflection{Summary: reflection.Summary, Facets: make([]model.ReflectionFacet, 0, len(reflection.Facets))}
	for _, facet := range reflection.Facets {
		result.Reflection.Facets = append(result.Reflection.Facets, model.ReflectionFacet{
			ID: facet.ID, Label: facet.Label, Kind: facet.Kind, Explanation: facet.Explanation, Practice: facet.Practice,
		})
	}
	f.Result = result
	return nil
}

func cloneReflection(value *model.ConversationReflection) *model.ConversationReflection {
	if value == nil {
		return nil
	}
	copy := *value
	copy.Facets = append([]model.ReflectionFacet{}, value.Facets...)
	return &copy
}

func reflectionView(value *model.ConversationReflection, fullAccess bool) *dto.ConversationReflection {
	if value == nil {
		return nil
	}
	out := &dto.ConversationReflection{Summary: value.Summary, Facets: make([]dto.ReflectionFacet, 0, len(value.Facets))}
	for _, facet := range value.Facets {
		visible := dto.ReflectionFacet{ID: facet.ID, Label: facet.Label, Kind: facet.Kind, Explanation: facet.Explanation}
		if fullAccess {
			visible.Practice = cp(&facet.Practice)
		}
		out.Facets = append(out.Facets, visible)
	}
	return out
}
