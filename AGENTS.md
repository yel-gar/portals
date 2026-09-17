# Backend info
Backend is inside `backend/` folder. Backend uses async FastAPI with SQLAlchemy, asyncpg as database backend. Dependency control system is poetry, so use `poetry` to run scripts and manage dependencies. Test system is pytest. Test coverage is controlled by coverage.py. Pre-commit hooks are set up in root directory.

## Rules
- Use typehints, project must be strictly typed, checked through mypy.

## Documentation
- API routes - necessary, summary and error codes must be explicitly listed
- Dependencies - necessary
- Pydantic models - only for fields that require explanation
- Database models - not needed, must be self-explanatory
- Code comments - no excessive section divisions, no titles, only appropriate amount of comments explaining the flow

## Structure
All changes to structure must be coordinated with user. If the file/directory does not exist, you may create it.
- `app/` contains main code, all items below are inside
- `models.py` - database models
- `db.py` - database session constructor
- `schemas.py` - pydantic models
- `deps.py` - dependencies functions and annotations. All frequently used dependency functions must use `Annotated[type, Depends(function)]` type alias for typehinting throughout the project.
- `routes/auth.py` - authorization manager

# `.context/` directory info
- `PROJECT_STATE.md` - put current plan, if it's present here. Put all completed milestones and added features here.
- `DECISIONS.md` - all architecture-related decisions must first be discussed with user then committed here. Any change conflicting with previously made decisions must be discussed with user.
- `LESSONS.md` - record user's corrections here to avoid making same mistake.
