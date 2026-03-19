import { Router, type IRouter } from "express";
import healthRouter from "./health";
import compileRouter from "./compile";

const router: IRouter = Router();

router.use(healthRouter);
router.use(compileRouter);

export default router;
