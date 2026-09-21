import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class CopilotQueryDto {
  @IsString()
  @IsNotEmpty()
  query: string;
}

export class ForecastFilterDto {
  @IsInt()
  @Min(30)
  @Max(365)
  @IsOptional()
  days?: number;
}

